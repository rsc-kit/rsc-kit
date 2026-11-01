# admin

React Server Components, served by Bun.

```sh
bun run dev         # vite — serves from source, no build step
bun run build       # bundles, then freezes every page it can
bun run start       # serve on http://localhost:3000
```

There is no server file here. `vite.config.ts` names a Nitro preset and the
server is built around your route tree, into `.output/` — changing where this
deploys is changing that one string.

`bun run compile` builds and then puts the whole application into
`dist/app` — engine, pages and assets, with Bun's runtime inside it. Run it
directly:

```sh
./dist/app
```

It builds first, so the binary is never a version behind your source. Frozen
pages stay outside it: a binary has no filesystem to read them from, so it
renders those live.

Freezing is part of `build`: it renders every page it can and stores the
result, so those pages are read off disk instead of rendered per visitor.
There is no switch to turn it off for the app; a page that must render per
request says `await connection()`, and the build names any page it could
not render.

## Where things go

    src/app/layout.tsx     the root layout; owns <html>
    src/app/page.tsx       /
    src/app/styles.css     imported by the layout
    src/components/        client components ("use client")

A directory with a `page.tsx` is a route, so `src/app/about/page.tsx` is
`/about` with nothing to register. `[slug]` is a parameter, and
`middleware.ts` runs before anything at or below it renders; its default export is one
check or a list of them, run in order and stopping at the first refusal.

`.rsc-kit/` is the build's: the route types that make `href` checkable, and
the ambient declarations. Rewritten every build, and gitignored.

Docs: https://docs.rsc-kit.dev
