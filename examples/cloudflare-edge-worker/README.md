# Edge worker

Serves pages from Cloudflare's edge cache: a static page whole, and a partially
prerendered page's build-time shell with your origin finishing it into the same
response. It speaks the [edge contract](https://docs.rsc-kit.dev/reference/edge-contract/),
so it works in front of any framework that implements it, rsc-kit or not.

```sh
openssl rand -hex 32                                          # the token, once
bunx wrangler secret put EDGE_TOKEN                           # paste it here
bun run deploy -- --var ORIGIN:https://your-app.example.com \
  --var "EDGE_MARKER:$(cat ../your-app/.output/edge.json | tr -d '\n')"
```

Start the origin with the same value in `EDGE_TOKEN`. Without it, the origin
answers the worker's page requests with 404, nothing is ever cached, and every
page is served by the origin as if the worker were not there. `ORIGIN` is where
the app runs; `wrangler.toml` ships a placeholder for it. `EDGE_MARKER` is the
release's `.output/edge.json`, so deploy the worker with each release.
Scope the worker with the commented `[[routes]]` block there: the pages the
marker lists, and `/assets/*`, where a static page's payload lives.

If your origin is **another Worker on the same account**, an HTTP fetch between
them is refused by Cloudflare with `error code: 1042` — and the body is a 20 kB
HTML error page that looks enough like a real response to be mistaken for one.
Use a service binding instead. When it is there the worker sends every call
through it, and `ORIGIN` only names the cache keys:

```toml
[[services]]
binding = "ORIGIN_SERVICE"
service = "your-origin-worker"
```

That is the whole deployment. There is no KV namespace, no build-time push and
no CI step: the cache fills itself from the origin's own page endpoint the
first time a page is asked for. The worker uses the contract's two endpoints:

```
GET  /_edge/page?path=/dashboard     the static page, or the build-time shell
POST /_edge/resume?url=/dashboard    a shell's holes, for this visitor
```

### Without the marker

The worker runs without `EDGE_MARKER`, for shells only. Every document request
is then looked up; a page with no shell has no cache entry, the page endpoint
answers `404`, and nothing is stored. That costs one extra origin request in
the background, never a slower response. A stale shell is still caught, since
its resume names another build.

A static page is not served without the marker. It has no resume, so nothing
but the marker's `build` can say a release has replaced it.

## What a visitor gets

| | |
| --- | --- |
| Cache miss | straight to the origin, and the page warms behind them — no request is ever slower for this worker existing |
| Cache hit, static page | the whole page from the edge; its scripts and payload are immutable assets, so the origin hears nothing of the visit |
| Cache hit, shell | the shell streams from the edge; the origin renders only the holes and they arrive on the same response |
| A cached entry from another build than the marker's | evicted, and the visitor goes to the origin |
| Resume fails, or a deploy changed the build | the shell has already gone out; the cache entry is evicted and the holes are filled by the client as it hydrates |
| Not a `GET`, an `X-RSC` payload fetch, or a query other than campaign tags (`utm_*`, `gclid`, …) | passed to the origin untouched; the shell cannot depend on the query |

The holes are placed by a small inline script React emits beside them, not by
hydration — so they appear as the HTML parses, without waiting for the app
bundle or for React to start. That is not the same as working with scripting
off: with JavaScript disabled the segments stay hidden and the fallbacks
remain.

## Why this cannot walk past a guard

The worker forwards **the visitor's own request** to the resume endpoint, so the
origin runs that route's middleware against their cookies and refuses exactly as
it would have for the document.

And a guarded route never becomes a cache entry in the first place: the page
endpoint answers `404` for any route that declares middleware, and to anyone
without the token. That is refusal
at the source rather than a check here — one fewer place to get it wrong.

## The postponed state

The contract has the worker send back whatever `state` came with the shell, as
the resume's body. An rsc-kit origin hands out an empty one and ignores the
body. It reads its own state from its build, so it never parses anything a
caller wrote, which is the shape of a known denial-of-service against Next's
resume. A framework that does use the state, like next-bun-compile, takes it
only from a caller holding the token.

## Measured, on a deployed pair

Both workers on Cloudflare, `/dashboard` (a shell with one 2.5 s hole), ten
samples each:

| | TTFB median |
| --- | --- |
| origin worker, direct | 55.1 ms |
| through this worker, shell from cache | 58.3 ms |

**Slower.** That result is real and worth understanding before deploying this.

A Worker origin already runs in the colo nearest the visitor, and its shell
lookup is an in-memory read. There is no distance to remove, so putting a second
Worker in front of it adds a hop and buys nothing.

This is for an origin the edge is actually *far from* — a VPS in one region, a
container, a Laravel app behind a load balancer — where producing the shell
costs a round trip plus render time that a cache hit removes entirely. If your
origin is itself a Worker, skip this and serve directly.

The correctness benefit is unconditional: the holes are in the initial HTML
either way, so they render before the app bundle loads rather than after
hydration.
