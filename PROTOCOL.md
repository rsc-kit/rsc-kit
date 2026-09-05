# The rsc-kit protocol

What a host has to do to drive the RSC engine, stated once so a second
implementation does not have to be read out of the first.

The engine renders React Server Components: it owns the route composition, the
Flight and HTML streams, actions, metadata and revalidation. A **host** owns
routing, request handling and whatever the application's data lives behind. The
two meet at the contract below.

There are two ways to be a host, and which one you are is decided by a single
question: **can your runtime execute JavaScript?**

| | in-process | out-of-process |
|---|---|---|
| host language | JavaScript | anything |
| how it calls the engine | imports it | a Unix socket |
| what it implements | [Part 1](#part-1-the-engine-contract) | Parts [1](#part-1-the-engine-contract) and [2](#part-2-the-socket-protocol) |
| reference | `tests/js/workerProtocol.test.ts`, the Hono spike | `src/RuntimeBridge.php` |

A JS host — Hono, Elysia, a Bun server — imports the built engine and calls it
directly. Everything in Part 2 exists only because PHP cannot run JavaScript;
skip it entirely if you can.

---

## Part 1: the engine contract

The build emits a server bundle whose exports are the whole surface. A host
imports it and calls these.

### Rendering

```ts
handleRscHtmlStream(component, props, layouts, loadings, parallelSlots,
                    slotOverrides, nonce?, pageKey?, bootstrap?)
  → { htmlStream, rscPayloadPromise, clientChunks }
```

A full page: HTML for a first visit, including the script tag that boots the
client. `bootstrap: false` omits that script, which is how a route ships no
JavaScript at all.

```ts
handleRscStream(component, props, layouts, loadings, parallelSlots,
                slotOverrides, from?, pageKey?)
  → { stream, clientChunks, segmentDepth }
```

A Flight payload, for hydration and for navigation. `from` says how many
layouts the browser already has mounted; the engine decides what is actually
safe to skip and reports it back as `segmentDepth`. **Do not assume the two
match** — an interceptor targeting an outer layout widens the render, because
an override can never reach a layout the client is keeping.

```ts
handleRscPayload(...)       → { rscPayload }    // the same, as a string
handleRscPprShell(...)      → { shellHtml, timedOut, usedDynamicApis, error? }
resolveMetadata(component, props, layouts) → Record<string, unknown> | null
```

Metadata resolves against the **whole** layout chain even when the render is
partial: a title template lives on an outer layout, and a partial render still
has to produce the title the whole document would have.

### Actions

```ts
handleAction(actionId, body, contentType?, page?, takeRevalidated?)
  → { stream }
```

`body` is `string | Uint8Array | FormData`. Bytes are the normal case; multipart
decodes to `FormData`, anything else to text.

`page` describes the page the action was invoked from — `{ component, props,
layouts, loadings, parallelSlots }` — and `takeRevalidated()` returns the names
the application marked stale while the action ran. Supply both and the answer
carries the re-rendered parts with it:

```jsonc
{ "__rscRevalidated": { "orders": <tree> }, "result": <the action's own value> }
```

Marked nothing, or no `page`: the result is serialized alone, exactly as it
would have been. **The envelope is marked, not shape-matched** — an action
whose own result is an object with a `result` key must not be mistaken for one.

### Revalidation

```ts
handleRscRevalidate(target, page) → { rscPayload }
```

One named region, rendered without the page around it. Three kinds of target:

- `all` — the whole document, layouts included
- `page` — everything below the layouts, which stay as they are
- a **section** or **slot** name — one region

A section is the light form: `export default section('orders', Component)`. A
slot is a parallel route. Sections resolve first. **What comes back is the
component, not the wrapper** — the client replaces what is inside the boundary,
so returning the wrapper would nest a new boundary inside the old one on every
refresh.

### Calling back into the host

```ts
installHostFn(async (name: string, ...args: unknown[]) => unknown)
  → () => void   // uninstall
```

This is the whole of it for a JS host:

```ts
engine.installHostFn(async (fn, ...args) => {
  if (fn === 'Ledger.orders') return db.orders.all()
  return null
})
```

A server component writes `await rpc('Ledger.orders')`. The global's name is the
host's choice (`rsc.host_global`, `RSC_HOST_GLOBAL`), and it must match what the
build was told, or every call is to a function that does not exist.

---

## Part 2: the socket protocol

For a host that cannot run JavaScript. It runs the worker as a separate process
and speaks this over a Unix socket.

### Framing

```
┌────────────┬──────────────────┐
│ 4 bytes BE │ payload          │
│ length     │ length bytes     │
└────────────┴──────────────────┘
```

Payloads are JSON, with one exception below. Frames larger than
`RSC_MAX_FRAME_SIZE` (default 1 MiB) are refused.

**A body frame is not JSON.** An action's body is raw bytes on its own frame,
following a header that declares it:

```jsonc
{ "type": "rsc-action", "actionId": "…", "bodyEncoding": "binary",
  "bodyLength": 4096, "contentType": "multipart/form-data; boundary=…" }
```
```
<the next frame is bodyLength bytes, verbatim>
```

Frames carry bytes, so a body needs no encoding to survive one. It is not
base64'd, and must not be: that inflates by a third and makes any size limit
measure the encoding rather than the file.

### Messages

| host → worker | answers with |
|---|---|
| `ping` | `pong` |
| `list` | `{ result: string[] }` |
| `rsc` | `{ result }` — with `target`, that result is `{ rscPayload }` |
| `rsc-payload` | `{ result: { rscPayload } }` |
| `rsc-ppr-shell` | `{ result: { shellHtml, … } }` |
| `rsc-stream` | `stream-start` → `stream-chunk`* → `stream-end` |
| `rsc-html-stream` | `html-start` → `html-chunk`* → `html-end` |
| `rsc-action` | `action-start` → `action-chunk`* → `action-end` |

An unknown message type, or a component that does not exist, is **answered with
an error frame** — never with silence. Silence is indistinguishable from a hung
worker until the idle timeout fires.

### Failures

Each is a frame, and each means something a host must translate:

```jsonc
{ "error": "…" }                                     → 500
{ "unauthenticated": true, "error": "…" }            → 401
{ "unauthorized": true, "error": "…" }               → 403
{ "validation_errors": { "field": ["…"] }, "error": "…" } → 422
{ "redirect": "/login" }                             → 302
```

A refusal only reaches these frames through an **action**. A host call that
fails inside a Suspense boundary is serialized into the stream by React and
never reaches the worker's error path.

### The callback channel

A server component calling `rpc()` needs the host mid-render, so the host opens
a second socket (`<socket>.cb`) and registers:

```jsonc
host → { "type": "register", "id": "<callbackId>" }
```

Then, for each call, with `callbackId` on the original render message:

```jsonc
worker → { "type": "callback", "id": "cb_1", "function": "Ledger.orders", "args": [] }
host   → { "id": "cb_1", "result": … }
```

The reply may also carry `revalidate: string[]` — what that call invalidated,
which is what lets the answer to an action bring the re-rendered parts with it
rather than telling the browser to ask again.

**A render that makes host calls needs this channel.** Without it the first
component that fetches anything fails, and in a production build the message is
stripped.

---

## Part 3: the HTTP protocol

Between the browser and the host. The engine never sees these.

| header | direction | meaning |
|---|---|---|
| `X-RSC` | → | send the Flight payload, not the page |
| `X-RSC-Version` | ↔ | the build; a mismatch mid-session answers 409 |
| `X-RSC-Segments` | → | the layout chain the client has mounted, outermost first |
| `X-RSC-Segment-Depth` | ← | the boundary this payload replaces; `0` is a whole document |
| `X-RSC-Layouts` | ← | the chain to send back next time |
| `X-RSC-Action` | → | the server reference being invoked |
| `X-RSC-Content-Type` | → | the body's real type, when the request is sent opaque |
| `X-RSC-Referer` | → | the page an action or interception came from |
| `X-RSC-Intercept` | → | render this route into the named slot |
| `X-RSC-Revalidate` | → | render only this target |
| `X-RSC-Location` | ← | follow this instead |
| `X-RSC-Redirect` | ← | the render redirected; go here (204 on a navigation) |

A failed action answers with **JSON or a redirect header, never a Flight
stream** — 422 with `{ message, errors }` for a refusal. Handing that to the
Flight decoder reports the decoder's confusion rather than what the server said.

**A redirect from a render is never a 3xx on a payload request.** `fetch`
follows one transparently, so the client receives the destination's HTML where
it expected a Flight payload and decodes it as one. A document gets the status
code; a navigation gets `204` and `X-RSC-Redirect`, and navigates itself.

**A redirect decided after the shell cannot use a header at all.** The status
line is spent. It travels instead in React's error digest, prefixed
`RSC_REDIRECT;<status>;<location>`, which the client's redirect boundary reads;
a document also receives a `location.replace` script appended to the stream, so
it does not have to hydrate first. Which window a redirect lands in is decided
by whether it was thrown above every Suspense boundary — a host must therefore
report a redirect on the **start frame** when it has one, and only then may it
write.

---

## Part 3b: the trust boundary

**Every header in the table above is written by the client, and none of them
can be verified.** The server cannot know what a browser really has mounted,
what page a request really came from, or which region it really wants. They are
claims, not facts.

The rule that follows: **a client-supplied header may narrow what is SENT. It
must never decide what is RUN.**

Three of them narrow a render, and each one was a way to skip server code
before the middleware mechanism existed:

| Header | Narrows | The abuse |
|---|---|---|
| `X-RSC-Segments` | how many layouts are rendered | name a layout you never received and it is not rendered — including whatever it was checking |
| `X-RSC-Revalidate` | to one region, with no layouts at all | ask for `page` and the entire chain above it is skipped |
| `X-RSC-Intercept` + `X-RSC-Referer` | to one slot, against a claimed page | choose which page the interceptor is composed against |

This is the shape of Next.js's CVE-2025-29927: a header the client controlled
decided whether middleware ran. Ours was reachable with one `curl` and returned
the guarded page's content with a 200.

**What a host must do.** A route's `middleware` — the `middleware.ts` files above it,
carried in the manifest, outermost first — must run before anything at or below
them renders, on every one of those paths, no matter how little of the chain was
asked for. A redirect or throw from one is the answer to the request.
`runGuards` in the engine is that; a host driving the engine another way owes
the same guarantee.

Middleware are deliberately outside the narrowing arithmetic. They are not layouts
and are never skipped, which is why a check belongs in one: a layout that
checks a session is usually a layout that also fetches chrome, and forcing it
to run charges every navigation for both.

**What a host must not assume.** Authorization in a layout protects a browser,
not an attacker. Route-level authorization belongs
in front of the handler, where every request passes through it regardless of
what it claims. A server action is a public endpoint: `POST /_rsc/action` with
an id and a JSON body invokes it, with no session and no referer needed.

**Bodies are untrusted too.** A non-multipart action body is the JSON model
`encodeReply` produced. Hand a malformed one straight to `decodeReply` and the
parse error surfaces inside a chunk nobody awaits: the promise never settles,
the request hangs, and the rejection escapes — fatal on Node, whose default is
to exit. Validate before decoding.

---

## Part 4: what a host has to get right

These are not API surface. They are the things that fail silently.

**`NODE_ENV` decides the React build at runtime, not at build time.** A host
that leaves it unset serves a development payload to a production client;
hydration fails, and the page renders perfectly and is inert. Nothing is
logged. Set it.

**Import the engine statically.** `await import(someVariable)` works when
interpreted and leaves the engine out of any bundle, so a compiled binary fails
at runtime against a path that no longer exists.

**Emit `stream-start` before the render, not after.** A blocking host flushes
its response headers on that frame. Emitting it afterwards holds the headers
behind the slowest call on the page — and waiting for it with a blocking read
deadlocks both sides, because the worker may itself be calling back.

**Drain the shell before releasing host calls.** A host call may run on the
thread pumping the socket, so nothing written during one reaches the browser.
Release after the first chunk and every Suspense fallback is stranded behind it.
Release after the whole shell has been drained.

**Serve the browser bundle.** The HTML references it by url; without it the page
renders and never hydrates.

**Prerendering must pass the real `loadings` and `parallelSlots`.** Passing
empty renders the page without its slots — whole apart from a missing region,
with nothing to say so.

**`params` and `searchParams` reach a page as promises, never as values.** The
build renders a parameterised route once, for the pattern rather than for any
url, and hands it params that never settle: the read suspends, the chrome
paints, and one stored shell serves every url the route matches. Spread the
values instead and the page renders to completion for an invented url — right
for nothing — which is why such a route could previously only be rendered per
request. A host that lists a route's urls passes the real ones, and that route
is stored whole.

---

## Conformance

`tests/js/workerProtocol.test.ts` drives a real worker over a real socket:
framing, the header/body split, every message type, every failure frame, and
both ordering invariants above. It is the executable half of this document —
each invariant has a test that fails when the behaviour is removed.

A new host is best checked against the same shape: render a page, hydrate it,
navigate without a reload, run an action, and take the worker away to see that
something is reported.
