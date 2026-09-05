# Brief for a security review

For someone reviewing `@rsc-router/core` before it is published. It says what
the system is, where the boundary is, what has already been found, and what has
not been looked at — so a reviewer spends their time on the last of those.

## What this is, in five lines

A file-based router for React Server Components. A **plugin** reads the route
tree at build time and generates entries; an **engine** renders a component and
its layout chain into a Flight payload and an HTML stream; a **host** owns HTTP
and decides how much of the page to send. `createRscHandler` is a host
(`Request` in, `Response` out) and the Laravel adapter is another, driving the
same engine from PHP over a Unix socket.

## The boundary

**Every `X-RSC-*` header is written by the client and none can be verified.**
The server cannot know what a browser has mounted, what page a request came
from, or which region it wants. They are claims.

The rule the code is meant to obey: *a client-supplied header may narrow what
is **sent**; it must never decide what is **run**.* Full table in
[`PROTOCOL.md`](./PROTOCOL.md), Part 3b.

Three headers narrow a render, and each is a way to ask for a subtree without
the chain above it:

| Header | Narrows to |
|---|---|
| `X-RSC-Segments` | the segment below the layouts the client claims to hold |
| `X-RSC-Revalidate` | one named region, with no layouts at all |
| `X-RSC-Intercept` + `X-RSC-Referer` | one slot, composed against a claimed page |

`POST /_rsc/action` takes an action id and a body, with no session.

## What has already been found

Found by probing, in about half an hour, before any formal review. Both were
live; both are fixed; both are pinned by tests in
`packages/core/tests/js/protocolAbuse.test.ts` and `tests/js/engine.test.ts`.

**1. Authorization bypass via a forged layout chain.** Claiming to hold the
layout that middleware a route skipped it:

```bash
curl -H 'X-RSC: true' -H 'X-RSC-Segments: app/layout' /guarded
  # 204, X-RSC-Redirect: /orders          the middleware ran

curl -H 'X-RSC: true' -H 'X-RSC-Segments: app/layout,app/guarded/layout' /guarded
  # 200, and the guarded page's content   it did not
```

**2. The same bypass through revalidation**, which renders without the chain
above the target by construction:

```bash
curl -H 'X-RSC: true' -H 'X-RSC-Revalidate: page' -H 'X-RSC-Referer: …/guarded' /guarded
```

Fix for both: a check moved out of the layout entirely. `middleware.ts` in a
directory runs before anything at or below it renders, on every path, and is
not part of what a partial render narrows — so there is no marker to forget and
no layout data fetching re-run to pay for. See `runGuards` in `src/vite.ts`.

A guarded route is never prerendered: a frozen page is served from disk before
anything renders, so no middleware could run for one. Middleware covers route renders
only. `POST /_rsc/action` renders no route, so no
middleware runs there; an action defends itself. Whether that split is the right one
is a fair question for a reviewer.

**3. Unauthenticated crash.** A malformed action body was parsed inside a React
chunk nobody awaited: the promise never settled, the request hung, and the
rejection escaped — fatal on Node, whose default is to exit. Now validated
before decoding.

## What has not been looked at

The honest list. Nobody has audited these:

- **Cache semantics.** `Vary: X-RSC` is set; no `Cache-Control` is. Prerendered pages, PPR shells (`shell_ttl` on the Laravel host advertises a CDN TTL) and Flight payloads all share a URL with the document. Is the key complete? Can one user's response be served to another?
- **The redirect destination.** `X-RSC-Redirect` is followed by the client without an origin check, and `redirect()` accepts whatever the app passes.
- **Per-request state.** `revalidate()`, `redirect()` and `cache()` each keep state in `AsyncLocalStorage` reached through `Symbol.for`, deliberately shared across duplicate copies of the module. `cache()` is the one that would hurt most if the scope leaked — a shared memo table hands one user another user's answer. There are tests for concurrent requests, but the scope's behaviour under streaming, and across the socket boundary in the Laravel worker, is unreviewed. See `src/cache.ts`, `src/revalidate.ts`, `src/redirect.ts`.
- **The Laravel socket bridge.** A length-prefixed binary protocol over a Unix socket, with a second callback socket per render. Frame handling, timeouts, worker pooling and the callback channel are unreviewed. See `RuntimeBridge.php`.
- **Server action arguments.** After `decodeReply`, arguments reach app code with no shape checking. What can be smuggled through — temporary references, client references, prototype pollution?
- **The dev server.** `RSC_DEV_CONFIG` starts a Vite dev environment. Not reviewed for what it exposes.
- **The build.** `generateStaticParams` and prerendering execute app code at build time; the export path writes files from route-derived names.

## Questions worth an answer

1. Is `middleware.ts` the right shape, and is "middleware cover renders, actions cover themselves" the right split?
2. Is there a way to make `X-RSC-Segments` verifiable — signed, or bound to something — without inventing a session the engine does not have?
3. Does anything in the partial-render paths leak content across the boundary the app intended, other than the two cases above?
4. Is `Vary: X-RSC` sufficient for every intermediary, given the same URL serves a document, a payload, and a PPR shell?

## Running it

```bash
bun install
bun run check              # build, typecheck, 415 tests
bun run verify:package     # pack, install, import on Node and Bun
cd examples/app && bun run build && bun run prerender && bun run start   # :8792
```

The example app has a `/guarded` route whose layout redirects, `/old-pricing`
which redirects from inside a Suspense boundary, a server action that mutates
state, an intercepted route, and both prerendered and dynamic pages — enough to
reproduce everything above.
