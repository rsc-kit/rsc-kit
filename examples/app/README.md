# The example app

The full route tree, built the way every scaffolded app is built: Nitro owns
the server, and the entry is generated.

    bun install
    bun run dev        # vite — no build step
    bun run build      # bundles, freezes every route it can, writes .output/
    bun run start      # bun .output/server/index.mjs

There is no server file in this directory. That is the point — `vite.config.ts`
names a Nitro preset and the server is built around the route tree. Changing
where it deploys is changing that one string.

## What the code is

```
src/app/layout.tsx               root layout — owns <html>
src/app/page.tsx                 /
src/app/loading.tsx              shown while a page's own await is outstanding
src/app/dashboard/page.tsx       /dashboard — streams behind <Suspense>
src/app/posts/[slug]/page.tsx    /posts/:slug — the segment arrives as a prop
src/app/@modal/                  a parallel slot, and an interception
src/app/account/middleware.ts    route middleware
src/components/Nav.tsx           "use client"
src/components/Counter.tsx       "use client" — state survives navigation
src/actions.ts                   "use server"
vite.config.ts                   nitro() + rscKit({ nitro: true })
```

There is no route table. `vite build` walks `src/app`, and adding
`src/app/settings/page.tsx` adds `/settings` with nothing else to edit.

## What the build prints

```
9 static, 3 partial prerender
```

Frozen pages go to `.output/server/rsc-static`, beside the server bundle, so
they travel with the deployment. `○` is stored whole; `◐` is a shell stored
with the dynamic part streamed in per request.

CI asserts those counts. A page that quietly stops being prerendered still
works — it just renders again for every visitor, which is the entire difference
and nothing reports it.

## Compiling

`bun run compile` produces a single-file executable with Bun's runtime inside.
`serveStatic: 'inline'` in the config is what makes its assets work: inside a
compiled binary the static path resolves into Bun's virtual filesystem, where
the files on disk are not.

The frozen pages are *not* embedded — the binary has no filesystem to read them
from, so it renders those pages live. Everything still answers.
