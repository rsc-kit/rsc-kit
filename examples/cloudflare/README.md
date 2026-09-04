# RSC on Cloudflare Workers

Does the engine run on workerd? Yes — with two settings, and neither fails
loudly when it is missing.

    bun x wrangler dev --local --port 8798

Verified in a browser against `wrangler dev`: SSR, hydration, a server action
(`Server total: 2`), partial navigation at depth 1, route interception filling
a slot with the page beneath intact, and assets served from the platform's
own binding rather than a filesystem.

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

`assets` is a function, so the Worker hands it the platform's asset binding:

    assets: async (pathname, request) =>
      pathname.startsWith('/assets/') ? await env.ASSETS.fetch(request) : null

`prerendered` is a function for the same reason and is simply not used here —
serving frozen pages from a Worker would read them from KV or the asset
binding rather than a disk.

## Deployed and checked, then taken down

The Worker was deployed, exercised, and deleted — the url below no longer
resolves. Redeploy with `wrangler deploy --config <this file's directory>`.

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

Deploy with an explicit config path, which avoids `npx` and a `cd`:

    node_modules/.bin/wrangler deploy --config path/to/wrangler.toml
