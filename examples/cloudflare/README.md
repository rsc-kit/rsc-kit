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

`/live` needs its D1 database and a signing secret before `bun run preview`:

```sh
cp .dev.vars.example .dev.vars          # then set RSC_SIGNING_SECRET (openssl rand -base64 32)
npx wrangler d1 migrations apply DB --local
```

## What the build makes of it

```
  ○  /             stored at build time, served as an asset - no render runs
  ◐  /visitor      a stored shell; the Worker renders the hole per request
  ◐  /live         a stored shell; the stock, from D1, filled per request
  ƒ  /api/time     answered by the Worker on every request
  ƒ  /api/restock  the webhook that changes the stock
```

- **`/`** reads nothing from the request, so the whole page is rendered once,
  at build time. The only JavaScript on it is the counter, the one client
  component.
- **`/visitor`** paints its heading at once from the stored shell. The part
  about you, under its own `<Suspense>`, reads `cf-ipcountry` and a cookie, and
  the Worker renders it per request. The button is a server action that sets
  the cookie and renders the page again.
- **`/live`** shows the stock from D1 in a section that refreshes on `stock`.
  `POST /api/restock` adds stock and calls `changed('stock')`, and every open
  tab refreshes the section - whichever isolate holds it, since the versions
  live in D1 too. The store is made inside a request (`src/versions.ts`): the
  build prerenders in Node, which cannot load `cloudflare:workers`.
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
