# Edge PPR worker

Serves a PPR route's build-time shell from Cloudflare's edge cache and has your
origin finish it, into the same response.

```sh
# point it at your app
wrangler deploy --var ORIGIN:https://your-app.example.com
```

That is the whole deployment. There is no KV namespace, no build-time push and
no CI step: the cache fills itself from the origin's own shell endpoint the
first time a page is asked for.

## What a visitor gets

| | |
| --- | --- |
| Cache miss | straight to the origin, and the shell warms behind them — no request is ever slower for this worker existing |
| Cache hit | the shell streams from the edge; the origin renders only the holes and they arrive on the same response |
| Origin declines | the shell is dropped and the visitor gets a whole page from the origin |

The holes are placed by React's own inline script, not by hydration, so they
land on a page whose JavaScript never loads.

## Why this cannot walk past a guard

The worker forwards **the visitor's own request** to the resume endpoint, so the
origin runs that route's middleware against their cookies and refuses exactly as
it would have for the document.

And a guarded route never becomes a cache entry in the first place: the shell
endpoint answers `404` for any route that declares middleware. That is refusal
at the source rather than a check here — one fewer place to get it wrong.

## What it does not send

The postponed state. Next's PPR protocol hands that blob to the CDN and takes it
back on the resume, which means the resume endpoint parses something an attacker
can write — the shape of a known denial-of-service against it.

Here the origin reads its own state off disk and the worker never sees it. A
body posted to the resume endpoint is ignored.
