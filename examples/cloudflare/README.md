# RSC on Cloudflare Workers

Does the engine run on workerd? Yes — with two settings, and neither fails
loudly when it is missing.

This directory is the spike that answered that, by mounting the engine by hand
with `createRscHandler`. It is kept for what it found, and **it does not build
as it stands**: `worker.ts` imports `../app/build/dist/rsc/index.js` and
`wrangler.toml` serves `../app/build/public`, and the example app no longer
writes either — Nitro is its only build now, and puts the rsc bundle elsewhere.

For a Worker today, use Nitro's preset instead of a worker file:
`bun create rsc-kit --host=worker`, or `nitro({ preset: 'cloudflare_module' })`
in an existing app. Nitro generates the `wrangler.json`, and the frozen pages
travel with the deployment. See the docs' *Where it runs* page.

## What was verified

Run against `wrangler dev`, when the example app still had a hand-mounted
build:

    bun x wrangler dev --local --port 8798

In a browser: SSR, hydration, a server action (`Server total: 2`), partial
navigation at depth 1, route interception filling a slot with the page beneath
intact, and assets served from the platform's own binding rather than a
filesystem.

## The two settings

**`compatibility_flags = ["nodejs_compat"]`.** Not optional and not ours:
`@vitejs/plugin-rsc` emits `import * as __viteRscAsyncHooks from
"node:async_hooks"` into both the rsc and ssr bundles, to set
`globalThis.AsyncLocalStorage` for React's edge build. Without the flag the
Worker does not load at all — which is at least a loud failure.

**`[define]` for NODE_ENV, not `[vars]`.** This one is silent. The server
bundle chooses React's build by reading `process.env.NODE_ENV`, and wrangler
substitutes that expression at *bundle* time — in `wrangler dev` it
substitutes `"development"`. A `[vars]` entry arrives too late to matter. The
Worker then serves a development payload to a production client: every page
renders, nothing is logged on either side, and nothing on the page is ever
interactive.

    [define]
    "process.env.NODE_ENV" = "'production'"

The tell is in the payload — React's development build emits debug rows:

    curl -s -H 'X-RSC: 1' http://localhost:8798/ | grep -c ':D{'

Twelve of them meant the development build. Zero is what a production one
looks like.

## What has no filesystem here

`assets` is a function, so the Worker hands it the platform's asset binding
(stashed on `globalThis` per request, since the handler is built once):

    assets: async (pathname, request) =>
      pathname.startsWith('/assets/') ? await globalThis.__ASSETS.fetch(request) : null

`prerendered` is a function for the same reason and is not used here, so this
Worker renders every page live.

## Deployed and checked, then taken down

The Worker was deployed, exercised, and deleted — the url below no longer
resolves.

    https://rsc-cf-spike.ramonmalcolm10.workers.dev   (deleted)

    Total Upload: 931.25 KiB / gzip: 167.03 KiB
    Worker Startup Time: 21 ms

Against the live deployment, not local workerd: SSR, hydration
(`Count: 2`), a server action (`Server total: 2`), partial navigation at
depth 1, interception filling the slot with the page beneath and its state
intact, closing it with no request at all, and assets from the binding.
TTFB 88 ms.

Size was never the concern it looked like — 167 KB gzipped against a 3 MB
limit. The ~1.3 MB figure was the raw engine bundle before tree-shaking.
