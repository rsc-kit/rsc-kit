# Stored renders: answering a public page without rendering it

Status: **shelved, 2026-10-06.** Not built, by decision: the latency it buys
on a repeat visit is ~60 → ~30 ms, below what anyone feels, where the
measurable race (60 ms against a 240 ms cache hit elsewhere) is already won.
Its real value is backend load - zero queries on repeat visits - and no
application has asked for that yet. Its cost is the one failure mode this
project is built to avoid: a stale copy served to everyone until a deploy,
silently, where a stale `refreshOn` tab today costs one visitor one page.
Revisit when a public, backend-heavy site needs the relief; design it against
that site.

Two conclusions from the review stand regardless. First, **no `shared`
declaration**: a page that exports `refreshOn`, sits under no guard and whose
render provably read nothing is enough - the build already classifies frozen
pages by observing one render, and the only way to take a personal path is
to read the request, which marks it. The `shared` reasoning below is kept as
the alternative that was considered and rejected. Second, every visit today
is **two renders** - the document and the boot payload - and the engine
already produces a rendered document's payload and discards it
(`rscPayloadPromise`); handing it to the boot fetch that follows is a
separate, smaller change with no staleness in it.

The renderer is as fast as it is going to get
- the client runtime is 10.7 kB gzipped, a navigation hop lands in 13-17 ms,
blocking time is 50 ms at a 24x CPU slowdown - and what remains of a page's
first byte is the render itself, done once per visitor. This is how a public
page gets answered without rendering it, with nothing guessed and nothing
served stale.

## What a visit costs today

faster.rsc-kit.dev, a product page, rsc-kit 0.29.9, median of 15 requests
from a laptop in the same region as the edge:

| | first byte | complete |
| --- | --- | --- |
| connection + TLS | 22-36 ms | |
| the document (stored shell, holes resumed on the worker) | 60 ms | 85 ms |
| the boot payload the client fetches to hydrate (`X-RSC`, 7 kB) | 72 ms | 93 ms |

Every response is `private, no-store`. The Worker runs and D1 is queried for
the document **and again** for the payload: two renders per visit, the
product query twice. The Next.js original answers the same page in 240 ms,
and that is a Vercel cache HIT - Vercel never ran their app for it.

So the floor is the connection, ~25-40 ms, and the gap to it is one render
per response. Closing it means not rendering.

## Why nothing is cached, and why that was right

Three facts, all deliberate (see `headers.ts`):

1. **The status line leaves before the render knows what it read.** A page
   that reads the visitor's cookies in a hole has already sent `200` with
   its shell. Nothing in the headers can promise the body is the same for
   everyone, so the body says `private`. `PER_REQUEST`'s own comment says
   exactly this.
2. **Cloudflare ignores `Vary`** except for `Accept-Encoding`. One url answers
   with a document, a payload and a segment; keyed by url alone, a cache
   hands one visitor another's body. So anything narrowed by a header says
   `no-store` outright.
3. **A guard runs per visitor.** A guarded page's content may be the same for
   everyone allowed to see it, but no cache in between may decide who that is.

And on Workers a fourth: Cloudflare does not cache a Worker's response at the
edge on its own. The Worker has to put it there itself, through the Cache API.
A `public, s-maxage` header on a Worker response does nothing.

The frozen whole page is the one exception already made: the build finished
it with nothing from a request, so it answers `public, max-age=0,
must-revalidate` (`REVALIDATE`). This design extends that exact treatment to
renders that finish the same way at request time.

## The rule

A finished render is kept, and answers the next request for the same url,
when **all** of these hold:

1. **The page says it is shared.** `export const shared = true` on the page -
   the word a section already uses, with the same contract: *renders the same
   for everyone allowed to see the page; never set it on anything that shows
   a visitor their own data.*
2. **The page says when it goes stale.** It exports `refreshOn`, the names of
   the data it shows - which it very likely already does, because that is
   also what makes open tabs refresh. A `shared` page without `refreshOn` is
   refused by the build: there is no way to know when its copy is wrong, and
   "until the next deploy" is not an answer for data the build itself could
   not finish.
3. **The route has no guard.** `middleware.ts` anywhere above it means per
   visitor, as it does for a frozen page today.
4. **The render read nothing from the request.** `cookies()`, `headers()`,
   `connection()`, `url()` and a params read the build could not settle all
   mark the request scope as read (`slot()` in `request.ts` sets `read` on
   every one of them). At the end of the render the host checks the mark.
   `searchParams` counts as a read in the first version.
5. **The render changed nothing on the way out**: no cookie queued, status
   200, a GET, not a form post, not a redirect, not a `notFound()`.

Decided **after** the render finishes, which is the one moment the engine
knows all five. The visitor whose render it was gets exactly today's
response - streamed, `private` - and the copy serves the next one.

### Why the declaration is needed, given the proof

Conditions 3-5 are facts the engine observes; it might seem they make the
declaration redundant. They do not, and the reason is worth keeping:

```tsx
export default async function Product({ params }) {
  const product = await find((await params).slug)
  if (product.onSale) {                              // only sometimes
    const seen = (await cookies()).get('sale-seen')  // reads the request
    ...
  }
}
```

The first render, with no sale on, reads nothing and is kept. The sale
starts; `changed('product:7')` drops the copy; the next render reads the
cookie and is not kept; fine. But a page can take the personal path on a
condition the names do not cover - who is asking, the time of day - and
then a copy made on the public path is served to a visitor who would have
been on the personal one. No observation of one render can rule that out.
`shared` is the author saying there is no such path, and the engine
**enforcing** it: a `shared` page whose render does read the request is not
kept, and the build report and the server log say so by name -
`cookies() in Product, declared shared`. A refusal that is not silence.

This is also why the opt-in is not inferred from `refreshOn` alone. A page
that declares what it shows has not said it shows the same to everyone.

### Why `shared` and not `revalidate = 60`

A time-to-live is a stale window by design: a product edited at 12:00:01 is
wrong until 12:01:00 for whoever asks. Names have no window. The copy is
right until something says the name changed, and then it is gone. That is
the contract `refreshOn` already makes with open tabs, and a stored copy
should not be allowed a weaker one.

## Freshness: a version is a read

The engine already learns, at render, the version of every name the page
depends on - that is how a tab knows what to watch (`refreshOn.tsx` asks
`versionSource().changed(...)` and signs each name). The copy is kept with
them:

```
{ build: 'e5edd098', names: { 'product:7': 1759790000123, 'catalog': 3 },
  etag: '"e5edd098-9f31c2"', body, headers }
```

On the next request the host asks the version source for those names'
current versions - one read, no render - and serves the copy if none moved.
If one did, the page renders, and the new copy replaces the old. Where the
versions live is already the source's business: this process, the Durable
Object hub (`RSC_CHANGES_HUB`), the backend behind `__rsc.changed`, or SQL.
Nothing new is stored anywhere; a stored copy is checked the way a tab is.

What that read costs: sub-millisecond in process or against the hub, one
host call (~ms) against a backend. Against a render plus a database query,
and against the 240 ms the alternative framework takes for a cache hit, it
is the right trade. There is no TTL, no purge API to configure, and no
cache-tag plumbing per CDN.

A deploy is a different build id, and a copy is keyed by it; a new server
never sees an old build's copies, and the `X-RSC-Version` 409 already
reloads a client of another build.

## Where copies live

**Everywhere: in the process.** A bounded map, by bytes, oldest out first -
the shape `compress.ts` already uses for stored answers and `files.ts` for
stored pages. One Bun or Node instance behind nothing gets the whole win from
this alone.

**On Workers: the Cache API.** The Worker runs for every request anyway; a
hit costs it the key, the version read and `caches.default.match`, and no
render. The key is the Worker's own - `origin + path + search`, with the
payload variant as a reserved marker so a document and a payload never share
one - which is what makes the `Vary` problem go away: the cache never sees a
header it has to vary on. The copy's versions ride in its own headers. The
Cache API is per colo, which is how every CDN cache works.

**Behind a CDN in front of Bun or Node.** A copy answers with
`public, max-age=0, must-revalidate` and an `ETag` - `REVALIDATE`, the
constant frozen pages already send - and a conditional request gets `304`
after the version read. The CDN keeps the body and pays only for the
confirmation. Documents only, in the first version: a payload shares its
url with its document, and a CDN that ignores `Vary` would conflate them.
Payloads stay in the process there.

The streamed response the first visitor got stays `private`. Only a copy
says `public`, because only a copy has been proven.

## What is answered from a copy

- The **document** (depth 0), whether it was rendered whole or a shell
  resumed on the server.
- The **boot payload** - `X-RSC` with no segments - which every visit fetches
  to hydrate and which today is the second render.

Together: a repeat visit to a shared page renders nothing and queries
nothing. Segment payloads (a navigation into the page from another) are the
natural next step and need nothing new beyond a key per depth; left out of
the first version to keep it small.

## What it does to nextfaster

Nothing, as the app is written. Its root layout puts two things behind their
own `<Suspense>` - the cart badge and who is signed in - and both read
cookies. They are holes, so they render in the document's resume and again
in the payload, and both renders are personal. Condition 4 fails on every
page, and the build would refuse `shared` on them, correctly.

The change is the standard one, and it is how the Next.js original earns its
cache HIT: the badge and the sign-in state become client components that ask
for their data after hydration - an action or a route answering `private`
with a few bytes. Then:

- the document and the payload read nothing;
- product pages export `shared` and `refreshOn: ({ params }) =>
  [`product:${params.product}`]`, category pages `category:…`, the home
  page `catalog`;
- a repeat visit is connection-bound - 25-40 ms to the first byte of
  document and payload alike - with zero D1 queries;
- a first visit is exactly today's.

The cost: the cart badge appears a round trip after the page, where today it
is in the document. The original pays the same. The number to watch is not
only first byte: Lighthouse at 24x CPU, score and TBT, before and after - a
client component that fetches on mount adds a task, and the early-payload
revert (#231) is the reminder that a faster-looking page can score worse.

## What this is not

- **Not inlining the boot payload into the document.** It would make a first
  visit one render instead of two, and it was tried: with the payload
  already present, decode and hydration ran as one long task, TBT went from
  50 ms to 450 ms at 24x, PageSpeed from 100 to 87, and it was reverted
  (#231). This design leaves first visits alone and makes repeat visits free.
- **Not a heuristic.** Nothing is kept because it looks public. A page is
  kept because its author said `shared`, said `refreshOn`, and its render
  proved both.
- **Not a stale window.** No TTL anywhere.
- **Not a change to streaming.** The first response of every page is the
  streamed one it is today.
- **Not a change to `PER_CLIENT`.** Guarded, personal and partial responses
  keep saying `no-store`.

## Order of work

1. **Engine: the proof.** At the end of a document or boot-payload render,
   read the request scope's `read` mark, the queued cookies, the status and
   the redirect/not-found scope, alongside the names and versions the render
   learned. One function, `keepable(render)`, with a reason when the answer
   is no. The reason goes to the log for a `shared` page.
2. **Engine: the store.** `storedRenders.ts`: bounded by bytes, keyed by
   `build + variant + url`, holding body, headers, names and versions, etag.
   A `source` interface with `get`/`put` so the Cache API can back it on
   Workers and the map everywhere else - the shape `prerendered` already
   takes a function for.
3. **Host: the two paths.** Before rendering a document or a boot payload on
   a `shared`, unguarded route: look up, read versions, serve or render.
   After rendering: keep if keepable. `ETag`/`If-None-Match` → `304`.
4. **Build: the declaration.** `export const shared` on a page, read the way
   `refreshOn` is (`urlSchemaExports`), refused without `refreshOn`, listed
   in the build report beside `ƒ`/`○` as its own mark.
5. **Tests.** `host.test.ts` with the fake engine: kept and served under the
   rule; not kept for each failing condition, with the reason; served copy
   dropped when a version moves; a new build sees no old copy; `304`. One
   e2e: two requests, the second with no render call.
6. **Workers backing.** `caches.default` when present; the e2e app's
   Cloudflare run covers it.
7. **Docs and MCP.** A "Stored renders" guide; the recipe on `shared`; the
   Boost skill's line on where to decide a page exists gains "or declare it
   shared".
8. **nextfaster.** Badge and sign-in client-side; `shared` + `refreshOn` on
   catalogue pages; measure first byte, D1 reads and Lighthouse at 24x
   before and after.

About 400 lines of engine and host, most of it the tests. Steps 1-5 are one
pull request; 6 and 8 are each their own, so a Workers problem or a
nextfaster regression is not tangled with the engine.

## Open questions

- **`searchParams`.** Treated as a read in the first version, so a search
  results page is never kept. It could be keyed by the full url, bounded;
  the question is whether an unbounded key space is worth a cap's
  eviction noise. Defer until a page wants it.
- **Shared sections.** `shared` on a section already means one render per
  change for the tabs asking (`sharedRenders.ts`, held 10 s). The same copy
  could be kept under this design's rule and serve segment payloads. Same
  word, same contract; a later step.
- **The version read on a hit, under load.** One read per request is the
  honest default. A single-flight per name - many requests in the same
  millisecond share one read - costs no freshness and is worth adding when a
  measurement asks for it, not before.
- **A `shared` page that reads the request.** Logged and not kept, as
  designed. Should the build also try to catch it statically - an import of
  `@rsc-kit/core/request` in a `shared` page's module graph? It would catch
  the common case early and miss the rest; the runtime check is the one that
  is complete.
