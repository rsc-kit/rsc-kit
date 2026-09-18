# Bakeoff

The same two pages in Next 16, TanStack Start and rsc-kit, production builds,
one machine, measured the same way. Re-run it with `bun run.ts` after
`npm install && npm run build` in each app directory.

## What is measured

Two pages, identical markup in every framework, fifty rows from an in-memory
array (`shared/data.ts`) so the framework is what varies:

- `/static` — a heading and the list. Nothing reads the request.
- `/dynamic` — the same, plus `Hello, {user}` from a cookie. Each framework's
  own way of a per-request page: Next renders the route on demand; Start runs
  a server function in the loader; rsc-kit stores a shell and streams the rest
  (a `loading.tsx` beside the page, which is what its build asks for).

A fifth row is rsc-kit with prerendering off — every page rendered live, an
internal switch (`RSC_PRERENDER=0`) that exists for the build's own reasons —
to answer whether opting out of the build costs anything.

Each server is started in production mode, warmed with 300 requests, then hit
with `oha -z 10s -c 50` per page. **TTFB** is the number that matters for a
streamed page — it finishes when its slowest boundary does, and what a
visitor feels is when it starts — so the table reports first-byte
percentiles, and full-response p50 beside them. **js kB** is every `<script>`
and `modulepreload` the document names, fetched and gzipped, summed: the
transfer before the page can be interactive.

## Machine

Apple M1, 8 cores, macOS. Load generator on the same machine, over loopback.
Single process everywhere: `next start`, Nitro's node server, Bun. Node
24.21, Bun 1.4.2, Next 16.3.5, `@tanstack/react-start` 1.168, `@rsc-kit/core`
0.16.1. The numbers compare shapes on one machine; they are not a claim about
your hardware.

## Results

Three pages now: `/dynamic-ppr` is the per-request page written the way an
RSC framework wants it — only the greeting is inside a `<Suspense>`, so the
list lives in the stored shell and only the greeting is rendered per visitor.
Next 16 does the same with `cacheComponents: true` (and, with that on, refuses
the plain `/dynamic` for the same reason rsc-kit does, until it has a
`loading.tsx`). Start has no partial prerender, so its row is the same page
rendered whole per request.

| server | page | req/s | TTFB p50 ms | TTFB p99 ms | html kB gz | js kB gz (files) | RSS idle MB | RSS peak MB | CPU ms / 1k req |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next 16 (next start, Node) | `/static` | 4,288 | 7.9 | 14.1 | 3.1 | 170.8 (6) | 293 | 449 | 444 |
| Next 16 (next start, Node) | `/dynamic` | 762 | 9.6 | 18.4 | 3.6 | 170.8 (6) | 293 | 527 | 2,027 |
| Next 16 (next start, Node) | `/dynamic-ppr` | 876 | 10.4 | 29.8 | 3.7 | 170.8 (6) | 293 | 594 | 1,774 |
| TanStack Start (Nitro, Node) | `/static` | 5,120 | 8.5 | 19.8 | 1.7 | 108.4 (3) | 105 | 333 | 255 |
| TanStack Start (Nitro, Node) | `/dynamic` | 5,072 | 8.7 | 20.5 | 1.7 | 108.5 (3) | 105 | 335 | 238 |
| TanStack Start (Nitro, Node) | `/dynamic-ppr` | 5,016 | 8.8 | 20.9 | 1.7 | 108.5 (3) | 105 | 335 | 238 |
| rsc-kit (Nitro, Node) | `/static` | 16,127 | 2.9 | 6.1 | 0.7 | **0.0 (0)** | 76 | 125 | **63** |
| rsc-kit (Nitro, Node) | `/dynamic` | 2,976 | 15.8 | 33.6 | 1.5 | 81.0 (4) | 76 | 273 | 373 |
| rsc-kit (Nitro, Node) | `/dynamic-ppr` | 4,010 | 11.5 | 28.4 | 1.5 | 81.0 (4) | 76 | 284 | 257 |
| rsc-kit (Nitro, Bun) | `/static` | 39,089 | 1.2 | 2.6 | 0.7 | **0.0 (0)** | 80 | 85 | **26** |
| rsc-kit (Nitro, Bun) | `/dynamic` | 4,549 | 10.6 | 21.8 | 1.5 | 81.0 (4) | 80 | 122 | 280 |
| rsc-kit (Nitro, Bun) | `/dynamic-ppr` | 5,700 | 8.4 | 17.2 | 1.5 | 81.0 (4) | 80 | 122 | 221 |
| rsc-kit, prerender off (Node) | `/static` | 2,871 | 16.2 | 34.0 | 0.9 | 81.0 (4) | 89 | 285 | 409 |
| rsc-kit, prerender off (Node) | `/dynamic` | 2,867 | 16.2 | 33.9 | 0.9 | 81.0 (4) | 89 | 285 | 391 |
| rsc-kit, prerender off (Node) | `/dynamic-ppr` | 2,839 | 16.4 | 34.5 | 0.9 | 81.0 (4) | 89 | 290 | 390 |

**RSS** is the resident memory of the server's whole process tree (`next
start` forks a worker), idle after the warm-up and at its peak during the
ten seconds. **CPU ms / 1k req** is CPU time the tree consumed during the
run divided by requests served — what a request costs, with throughput
divided out.

Three runs across the evening; the rows moved by a few percent between them.
The rsc-kit rows are from `@rsc-kit/core` with stored pages held in memory
after the first read (0.16.2); the first run, which read them from disk on
every request, had the static page at 11,700 on Node.

## What it says

**The static page is where the design pays.** rsc-kit stores it as a file
and serves it from memory: 3.8× Next's throughput and a third of its first
byte on the same Node; on Bun 9× with a 1.1 ms first byte. It also ships
**no JavaScript** for that page — Next sends 171 kB across six files, Start
108 across three — because nothing on it needs a runtime. Next and Start
prerender it too; the difference is that they still ship the runtime and
serve the file through more machinery.

**The whole-page-per-request row is where an RSC pass costs more than a
single SSR pass, and it shows.** Start renders once; rsc-kit renders server
components to a flight payload and then that payload to HTML - a profile
puts about 60% of the work in React's flight serialisation, encoding and
parsing. On Node that is 3,000 req/s to Start's 5,100. It is still 3.9×
Next, which pays the same two renders. On Bun the gap to Start narrows to
4,600 against 5,100.

**Written the way the framework wants, the gap closes.** With only the
greeting per request and the list in the stored shell, rsc-kit reaches
4,200 on Node and **5,700 on Bun — past Start**, whose page has no shell to
reuse and renders whole every time. Next's partial prerender, the same
shape, is 895. This is the honest summary of the trade: an RSC framework
pays a second render for a per-request page and gets back the stored page,
the shell that paints before the data, 81 kB instead of 108 or 171, and
server-only code that never ships.

**Memory and CPU tell the same story more plainly than throughput.** Idle,
rsc-kit is a 76 MB process on Node and 80 on Bun; Start is 105; Next is 293
before it has served anything and 594 at peak. Per thousand requests of the
static page, rsc-kit spends 63 ms of CPU on Node and 26 on Bun, Start 255,
Next 444 — the file is a file. On the page written for a shell, rsc-kit's
CPU per request (257 ms on Node) is within eight percent of Start's (238):
the two-render cost is real on the whole-page row (373) and nearly gone
when only the greeting renders. Next is 1.8–2.0 s of CPU per thousand
requests on either dynamic page.

**Opting out of the build costs 5.6× on the page that could have been
stored.** With prerendering off the static page renders live at 2,900
req/s and a 16 ms first byte, against 16,300 and 3 ms when stored, and ships
81 kB of runtime it did not need. The per-request pages are unchanged, as
they should be. That is why there is no public switch for it, and
`connection()` — one page, one declaration — is the way to opt a page out.

## Caveats, stated plainly

- One machine, loopback, the load generator sharing the CPU. Absolute
  numbers will differ on a server; the ratios are what to read.
- Single process each. `next start` and Nitro can cluster; so can Bun. None
  did here.
- Fifty rows is a small page. A heavy page shifts every row toward render
  time and narrows the static gap in relative terms — the file is still a
  file.
- Start's `/dynamic` runs a server function in its loader; a page that
  awaited a real database would add that cost to every framework equally.
- `cacheComponents: true` is on for Next, so its rows are its partial
  prerender mode; without it `/dynamic-ppr` would render whole per request.
- Not measured: hydration time, navigation, or anything a browser does.
  `js kB` is the proxy for it.
