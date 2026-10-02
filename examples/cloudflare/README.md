# rsc-kit on Cloudflare Workers

What `bun create rsc-kit@latest my-app --host=worker` writes, with three pages
that show what a Worker does with them. The server is Nitro's
`cloudflare_module` preset; there is no worker file to write.

```sh
bun run dev        # vite: the renderer, with hot reload
bun run build      # .output/, for Workers
bun run preview    # wrangler dev, on workerd, the Workers runtime
bun run deploy     # build, then nitro deploy --prebuilt
bun run test       # the app as it is deployed, no port and no browser
```

## What the build makes of it

```
  ○  /             stored at build time, served as an asset - no render runs
  ◐  /visitor      a stored shell; the Worker renders the hole per request
  ƒ  /api/time     answered by the Worker on every request
```

- **`/`** reads nothing from the request, so the whole page is rendered once,
  at build time. The only JavaScript on it is the counter, the one client
  component.
- **`/visitor`** paints its heading at once from the stored shell. The part
  about you, under its own `<Suspense>`, reads `cf-ipcountry` and a cookie, and
  the Worker renders it per request. The button is a server action that sets
  the cookie and renders the page again.
- **`/api/time`** is a `route.ts`. `await connection()` says it answers per
  request; without it the build would store the answer it got at build time.

## Two settings worth knowing

- **`compatibilityDate`** in `vite.config.ts` pins the Workers runtime's
  behaviour to that day. Left to Nitro it is each build's own date, so the
  runtime could change between builds, and a local `wrangler` older than the
  build refuses to run it.
- **`preview` is `wrangler dev`, with no entry.** The build leaves
  `.wrangler/deploy/config.json` pointing at `.output/server/wrangler.json`,
  and wrangler refuses an entry argument beside it.

Where else it runs, and what changes: [docs.rsc-kit.dev/hosts/where-it-runs](https://docs.rsc-kit.dev/hosts/where-it-runs).
