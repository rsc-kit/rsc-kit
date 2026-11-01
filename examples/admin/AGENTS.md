<!-- rsc-kit:start {"version":"0.1.0","host":"bun","sourceDir":"src","env":false,"pwa":false,"backend":false} -->
# Working in this project

React Server Components through `@rsc-kit/core`, a Vite plugin. Routes are
files under `src/app`. There is no server file to edit — the build
generates it.

Read the guides at https://docs.rsc-kit.dev before reaching for a pattern from
another framework. The notes below are only the things most often got wrong.

The `rsc-kit` MCP server in `.mcp.json` answers from this project's last
build — which routes froze and why, what is heaviest — and has the long-form
recipe for anything here (`how_to`). Ask it before guessing.

## Rules

Follow these on every change. Each is explained further down.

- **A change is not done without its test**, and not done until `bun run check` passes.
  A route, action, query or api route that is added or changed gets one.
- **Every environment variable is declared in `src/env.ts`** - server or
  `VITE_` client schema - and in `.env.example`, rsc-kit's own included
  (`RSC_SIGNING_SECRET`, once a page uses `refreshOn`). Server code reads
  `env` from it, never `process.env`; a client component reads its `VITE_` value
  from `import.meta.env`, already checked there. No `env.ts` yet? `how_to({ topic: 'env' })` sets it up.
- **Pages paint at once.** A page is synchronous; each read is an async
  component under its own `<Suspense>`. Reach for `loading.tsx` only when a
  route's whole body is one read.
- **Server components call the data function directly** - never `fetch` this
  app's own api routes from the server.
- **Live data**: `refreshOn` on the section and `changed()` where the data
  changes. `usePolling` only for data nothing can announce. Never
  `setInterval` with `refresh()`.
- **Every action and query is built from the client in `src/server/client.ts`**,
  and authorisation is its `.use()` middleware - never a check written in a
  component, and never a bare `'use server'` function for anything that writes.
- **Links and redirects are typed**: ``<Link href={`/posts/${slug}`}>``, a template
  literal, so a renamed route fails the typecheck. Never build urls by
  concatenation.
- **Metadata is `export const metadata`** (or `generateMetadata`), never tags in
  a page's markup.
- **Never edit generated files**: `.rsc-kit/`, `src/server-actions.generated.ts`,
  `rsc-host.json`. Change what they are generated from.
- **Secrets are generated, never invented or committed**: `openssl rand -base64 32`,
  kept in `.env` (ignored) and the platform's secret settings.
- **Ask before guessing**: `how_to` has the pattern for anything here; a
  pattern from another framework is usually wrong here.

## Commands

```sh
bun run dev        # vite, with the engine in it
bun run build      # builds and prerenders; prints what it froze
bun run check      # typecheck, lint and tests — run before saying it is done
```

Tests live in `tests/` and go through the real build: `createTestApp()` from
`@rsc-kit/core/testing` hands back the deployed Request → Response handler,
so a test fetches a url and reads the response. Extend `tests/app.test.ts`;
do not add a runner, a port or a spawned server. Actions, queries and api
routes are plain functions and can also be called directly.

**A change is not done without its test.** A guarded route gets a test that a
stranger is turned away; an action gets a test of its refusal, and one that
someone else's id is refused; an api route gets its 4xx. The exact shapes are
in `how_to({ topic: 'testing' })`. Then `bun run check`. Nothing here needs
the app running - the build and the tests are the verification.

**Read the build output.** It is not decoration — it says which routes were
stored, which render per request, and why:

```
  ○  /account               85 kB
  ◐  /locale                85 kB
     cookies(), headers() stream per request; the rest is stored
```

If a page you expected to be static is not, the reason is on that line. Do not
guess at it.

## Server and client

Every component is a **server** component unless its file starts with
`"use client"`. Server components can be `async` and read the database
directly. They do not ship to the browser.

Add `"use client"` only when the file needs state, an effect, an event
handler or a browser API. It is a boundary, not a label: everything that file
imports goes to the browser too.

`"use server"` is a different thing and not the opposite. It marks a module
whose exports may be **called from** the browser — a server action.

```ts
'use server'
export async function createPost(input) { … }   // callable from a client component
```

Do not put `"use server"` at the top of a page to make it a server component.
It already is one.

A callback that a timer, a subscription or a listener calls and that must see
the latest props is `useEffectEvent` from React, not a ref you assign every
render. An Effect Event is never a dependency: leave it out of the array. The
engine's own hooks are written this way.

## Reading the request

`cookies()`, `headers()` and `searchParams()` come from
`@rsc-kit/core/request` and are **async**. So are a page's `params` and
`searchParams` props, and an api route's.

Reading any of them makes the page render per request instead of being frozen
at build time. That is usually correct — just know that it is the trade.

`await connection()` says "render this per visitor" deliberately, when
nothing else in the page happens to say it.

## Startup

`src/instrumentation.ts` runs once before anything else — at
startup on a server, at the first request on a Worker — and the entry imports
it before any page. Put once-per-process setup there (`register()` may be async, and the first
render waits for it). Do not import a bootstrap module from pages to get the
same effect; it depends on nobody forgetting.

## Forms

Uncontrolled. Inputs keep their value in the DOM, an initial value is
`defaultValue`, and the action reads `FormData`. Do not write `useState` +
`value`/`onChange` per input.

Read a form with two words and nothing else: `error('title')` for a field's
error, `field('title')` to bind the one field whose value the UI must hold.
In a child component `useForm()` returns the same object. There is no
`errors` map, `fieldState` or `useFormStatus` to reach for.

## Data

Fetch in a server component and await it. There is no loader and no
`getServerSideProps`.

Better still, do not await it — pass the promise to a client component and let
it `use()` the value. The shell paints immediately and the data streams into
the same response, with no request from the browser:

```tsx
export default function Page() {
  const posts = getPosts()            // not awaited

  return (
    <Suspense fallback={<Skeleton />}>
      <List posts={posts} />          {/* "use client": use(posts) */}
    </Suspense>
  )
}
```

For data the **browser** decides to fetch — a filter, a refresh — use TanStack
Query or SWR. This project does not ship a cache and should not grow one.

## Actions, and where the check goes

An action is a public endpoint. Anyone can call it directly, so the
authorisation check belongs **inside the action**, never in the component that
renders the button.

Build actions from a client so the check cannot be forgotten:

```ts
'use server'
import { createActionClient } from '@rsc-kit/core/action'

export const client = createActionClient().use(async ({ next }) => {
  const user = await currentUser()

  if (!user) throw new ServerAuthenticationError()

  return next({ ctx: { user } })
})

export const createPost = client.input(schema).handler(async ({ input, ctx }) => …)
export const listPosts  = client.query(async ({ ctx }) => …)
```

`.handler()` is a mutation, `.query()` is a read sent as a GET. Both run
the middleware, so `ctx.user` is typed and non-null inside them.

Authorise on **identity, not arguments**. `deletePost(id)` that trusts the id
is an IDOR — the caller chooses the id.

Middleware in `middleware.ts` guards a route tree. It does **not** run for
actions, because an action renders no route.

## Urls are input

Export a schema beside the page or route and the values arrive parsed and typed:

```ts
export const params = z.object({ slug: z.string().min(1) })
export const searchParams = z.object({ page: z.coerce.number().int().min(1).default(1) })
```

Bad `params` answer 404, bad `searchParams` reach the error boundary. Do
not hand-parse `Number(searchParams.get('page'))`.

## Api routes

`src/app/**/route.ts`, exporting `GET`, `POST` and so on.
A real `Request` in, a real `Response` out. Await `params`,
`searchParams` and `body` from the second argument - never
`new URL(request.url).searchParams`, which the build cannot see.

They run their directory's `middleware.ts`, and a `GET` that reads nothing
from the request is answered from disk.

## Live data

A section that names what it depends on refreshes in every open tab when
something says that changed - a webhook, a job, another visitor:

```tsx
export default section('repos', Repos, { refreshOn: ({ params }) => [`team:${params.team}:repos`] })
```

```ts
await changed(`team:${team}:repos`)   // after the write commits
```

Name the data with ids, as narrowly as it changes. More than one process
needs a shared store, and production needs `RSC_SIGNING_SECRET` - declared in `env.ts`, required in production, so a deploy without it fails at startup:
`how_to({ topic: 'refresh-on' })`, or the Live data guide.

## Things that are not this project

- No `pages/` directory, no `_app`, no `getStaticProps`.
- No `next/link`, `next/image` or `next/navigation` — use
  `@rsc-kit/core/Link` and `@rsc-kit/core/navigate`.
- No `express`/`fastify` server to write. Do not add one.
- Do not install a state manager to move data from server to client. Props and
  promises already cross that boundary.
<!-- rsc-kit:end -->
