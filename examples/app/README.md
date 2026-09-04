# RSC on Hono

React Server Components served by a Hono backend, using `rsc-router`.

    bun install
    bun run build      # vite build — discovers routes, writes build/
    bun run start      # http://localhost:8792

## What the code is

```
src/app/layout.tsx           root layout — owns <html>
src/app/page.tsx             /
src/app/loading.tsx          shown while a page's own await is outstanding
src/app/dashboard/page.tsx   /dashboard — streams behind <Suspense>
src/app/posts/[slug]/page.tsx  /posts/:slug — the segment arrives as a prop
src/components/Nav.tsx       "use client"
src/components/Counter.tsx   "use client" — state survives navigation
src/components/Activity.tsx  server component, deliberately slow
src/actions.ts               "use server"
server.ts                    the entire backend
vite.config.ts               rscRoutes()
```

There is no route table. `vite build` walks `src/app`, writes `build/routes.json`,
and the server reads it — so adding `src/app/settings/page.tsx` adds `/settings`
with nothing else to edit.

## The whole backend

```ts
import { Hono } from 'hono'
import { rsc, assetsFrom } from '@rsc-router/core/hono'
import * as engine from './build/dist/rsc/index.js'
import manifest from './build/routes.json'

const app = new Hono()

app.use('*', rsc({
  engine,
  manifest,
  assets: assetsFrom('./build/public'),
  rpc: {
    stats: () => ({ users: 1_284, uptime: '18d 4h' }),
  },
}))

app.get('/health', (c) => c.json({ ok: true }))

export default { port: 8792, fetch: app.fetch }
```

`rsc()` is middleware, not a mounted router: a url the manifest does not claim
falls through, so `/health` and any API routes still work.

`rpc` is what `await rpc('stats')` reaches from a server component. In the
Laravel host that name crosses a socket into PHP and back. Here it is a
function call, which is most of why a JS host is 40 lines instead of 2,400.

## Not Hono-specific

`rsc-router/hono` is a 15-line binding. The real adapter is `rsc-router/host`,
which takes a `Request` and returns a `Response`:

```ts
import { createRscHandler } from '@rsc-router/core/host'

const rsc = createRscHandler({ engine, manifest })

Bun.serve({ fetch: async (req) => (await rsc(req)) ?? new Response('', { status: 404 }) })
```

Same handler under Deno, Workers, or Node's fetch adapters.

## Two things a host must get right

Both are silent when wrong.

**`NODE_ENV=production`.** The server bundle picks its React build at runtime,
so leaving it unset serves a development payload to a production client.
Hydration fails and the page never becomes interactive, with nothing logged.

**Answer navigations partially.** The adapter reads `X-RSC-Segments`, sends the
shared depth to the engine, and reports back the depth the engine actually
rendered. A host that always returns a whole document replaces the root on
every navigation — and replacing the root unmounts every page retained behind
it, so the counter resets and a half-typed form is lost. That is the difference
`<Activity>` retention rides on; it has nothing to do with owning `<html>`.

## Compiling

`bun run compile` produces a single-file executable, Bun's runtime included.
The engine is imported statically for this reason: a bundler cannot see through
`import(variable)`, so a dynamic import would leave it out of the binary and
fail at runtime against a path that no longer exists.
