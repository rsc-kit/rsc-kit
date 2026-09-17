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

A fifth row is rsc-kit with `prerender: false` — every page rendered live —
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

| server | page | req/s | TTFB p50 ms | TTFB p99 ms | full p50 ms | html kB gz | js kB gz (files) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Next 16 (next start, Node) | `/static` | 4,304 | 8.0 | 15.1 | 10.9 | 3.1 | 170.8 (6) |
| Next 16 (next start, Node) | `/dynamic` | 773 | 9.5 | 19.1 | 63.0 | 3.6 | 170.8 (6) |
| Next 16 (next start, Node) | `/dynamic-ppr` | 895 | 12.7 | 31.6 | 54.6 | 3.7 | 170.8 (6) |
| TanStack Start (Nitro, Node) | `/static` | 5,131 | 8.5 | 20.0 | 8.6 | 1.7 | 108.4 (3) |
| TanStack Start (Nitro, Node) | `/dynamic` | 5,099 | 8.7 | 20.2 | 8.7 | 1.7 | 108.5 (3) |
| TanStack Start (Nitro, Node) | `/dynamic-ppr` | 5,092 | 8.7 | 20.4 | 8.7 | 1.7 | 108.5 (3) |
| rsc-kit (Nitro, Node) | `/static` | 16,323 | 2.9 | 5.9 | 2.9 | 0.7 | **0.0 (0)** |
| rsc-kit (Nitro, Node) | `/dynamic` | 3,017 | 15.6 | 32.8 | 15.6 | 1.5 | 81.0 (4) |
| rsc-kit (Nitro, Node) | `/dynamic-ppr` | 4,185 | 11.2 | 23.1 | 11.3 | 1.5 | 81.0 (4) |
| rsc-kit (Nitro, Bun) | `/static` | 39,840 | 1.1 | 2.6 | 1.1 | 0.7 | **0.0 (0)** |
| rsc-kit (Nitro, Bun) | `/dynamic` | 4,586 | 10.5 | 21.5 | 10.5 | 1.5 | 81.0 (4) |
| rsc-kit (Nitro, Bun) | `/dynamic-ppr` | 5,696 | 8.4 | 17.0 | 8.5 | 1.5 | 81.0 (4) |
| rsc-kit, prerender off (Node) | `/static` | 2,890 | 16.0 | 33.9 | 16.1 | 0.9 | 81.0 (4) |
| rsc-kit, prerender off (Node) | `/dynamic` | 2,889 | 16.2 | 33.8 | 16.2 | 0.9 | 81.0 (4) |
| rsc-kit, prerender off (Node) | `/dynamic-ppr` | 2,839 | 16.4 | 35.4 | 16.4 | 0.9 | 81.0 (4) |

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

**Opting out of the build costs 5.6× on the page that could have been
stored.** With `prerender: false` the static page renders live at 2,900
req/s and a 16 ms first byte, against 16,300 and 3 ms when stored, and ships
81 kB of runtime it did not need. The per-request pages are unchanged, as
they should be. That is why `prerender: false` is for a build machine that
cannot reach the data, and `connection()` — one page, one declaration — is
the way to opt a page out.

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
