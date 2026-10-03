# The example app

The full route tree, built the way every scaffolded app is built: Nitro owns
the server, and the entry is generated.

    bun install
    bun run dev        # vite — no build step
    bun run build      # bundles, freezes every route it can, writes .output/
    bun run start      # bun .output/server/index.mjs
    bun run test       # bun test tests
    bun run typecheck  # tsc --noEmit

There is no server file in this directory. That is the point — `vite.config.ts`
names a Nitro preset and the server is built around the route tree. Changing
where it deploys is changing that one string.

## What the code is

```
src/app/layout.tsx                 root layout — owns <html>, renders the @modal slot
src/app/page.tsx                   / — paints at once; only the stats wait, in a <Suspense> slot
src/app/dashboard/page.tsx         /dashboard — paints at once, the slow list streams behind <Suspense>
src/app/streaming/page.tsx         /streaming — promises passed down, resolved with use()
src/app/posts/[slug]/page.tsx      /posts/:slug — params awaited under a boundary, frozen once as a shell
src/app/direct/[slug]/page.tsx     /direct/:slug — generateStaticParams, frozen per url
src/app/@modal/                    a parallel slot, and an interception of /posts/:slug
src/app/orders/                    section() — an action re-renders the list alone
src/app/search/page.tsx            typed searchParams, declared with zod
src/app/infinite/, pagination/, polling/   TanStack Query over query() reads; the first page is a server slot
src/app/events/, api/seats/events/   server-sent events, read with useEvents()
src/app/webhook/, api/stock/restock/   a section refreshed by a webhook: refreshOn, changed()
src/app/breaks/                    error.tsx catching a failure at request time
src/app/account/middleware.ts      middleware that sets a response header and a cookie
src/app/guarded/middleware.ts      a guard that redirects, covering a page and an api route
src/app/locale/middleware.ts       middleware that settles the locale before rendering
src/app/old-pricing/page.tsx       a redirect from inside a render
src/app/api/                       route.ts api routes
src/app/reference/route.ts         Scalar over the generated /openapi.json
src/app/manifest.ts, robots.ts, sw.js, offline/   PWA, SEO files, the offline fallback
src/components/                    "use client" — Counter keeps its state across navigation
src/actions.ts                     "use server"
src/queries.ts                     query() reads, reachable over GET
vite.config.ts                     nitro() + rscKit({ offline, openapi })
```

There is no route table. `vite build` walks `src/app`, and adding
`src/app/settings/page.tsx` adds `/settings` with nothing else to edit.

## What the build prints

```
20 static, 5 partial prerender, 4 dynamic
```

Api routes and SEO files are counted with the pages. Frozen pages go to
`.output/server/rsc-static`, beside the server bundle, so they travel with the
deployment. `○` is stored whole; `◐` is a shell stored with the dynamic part
streamed in per request; `ƒ` renders for every request.

CI asserts those counts. A page that quietly stops being prerendered still
works — it just renders again for every visitor, which is the entire difference
and nothing reports it.

## Testing

`bun run test` runs three tiers: functions called directly, request scope
opened by the test, and the whole app as Request → Response through
`createTestApp()`. That last one builds first when the source is newer than the
last build, so it tests the pages the server actually serves.

## Compiling

`bun run compile` turns `.output/server/index.mjs` into a single-file
executable, `rsc-app`, with Bun's runtime inside. It compiles whatever
`.output` holds, so run `bun run build` first. `serveStatic: 'inline'` in the
config is what makes its assets work: inside a compiled binary the static path
resolves into Bun's virtual filesystem, where the files on disk are not.

The frozen pages are *not* embedded. `index.mjs` reads them through an import a
compile cannot see, so this binary renders those pages live — everything still
answers. To embed them, compile `.output/server/compile.mjs` instead: the build
writes it for that, and a scaffolded app's `compile` script uses it.
