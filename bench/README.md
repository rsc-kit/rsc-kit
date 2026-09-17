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

| server | page | req/s | TTFB p50 ms | TTFB p99 ms | full p50 ms | html kB gz | js kB gz (files) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Next 16 (next start, Node) | `/static` | 4,437 | 7.9 | 14.1 | 10.6 | 3.2 | 170.5 (6) |
| Next 16 (next start, Node) | `/dynamic` | 975 | 23.4 | 46.4 | 50.3 | 3.1 | 170.5 (6) |
| TanStack Start (Nitro, Node) | `/static` | 5,277 | 8.2 | 19.1 | 8.3 | 1.7 | 108.3 (3) |
| TanStack Start (Nitro, Node) | `/dynamic` | 5,205 | 8.5 | 19.8 | 8.5 | 1.7 | 108.3 (3) |
| rsc-kit (Nitro, Node) | `/static` | 11,692 | 4.1 | 6.7 | 4.1 | 0.7 | **0.0 (0)** |
| rsc-kit (Nitro, Node) | `/dynamic` | 2,715 | 18.0 | 23.8 | 18.0 | 1.5 | 81.0 (4) |
| rsc-kit (Nitro, Bun) | `/static` | 32,978 | 1.2 | 3.7 | 1.2 | 0.7 | **0.0 (0)** |
| rsc-kit (Nitro, Bun) | `/dynamic` | 4,371 | 11.3 | 20.7 | 11.3 | 1.5 | 81.0 (4) |
| rsc-kit, prerender off (Node) | `/static` | 2,893 | 16.1 | 34.1 | 16.1 | 0.9 | 81.0 (4) |
| rsc-kit, prerender off (Node) | `/dynamic` | 2,869 | 16.1 | 34.5 | 16.2 | 0.9 | 81.0 (4) |

Two runs, ten seconds each; the second matched the first within a few percent.

## What it says

**The static page is where the design pays.** rsc-kit stores it as a file
and serves it as one: 2.6× Next's throughput and half its first byte on the
same Node, and on Bun 7× with a 1.2 ms first byte. It also ships **no
JavaScript** for that page — Next sends 170 kB across six files, Start 108
across three — because nothing on it needs a runtime. Next and Start
prerender it too; the difference is that they still ship the runtime and,
in Next's case, serve it through more machinery.

**The per-request page is where rsc-kit does more work than Start, and it
shows.** Start renders once (SSR); rsc-kit renders server components to a
flight payload and then that payload to HTML, and stores a shell besides.
On Node that is 2,700 req/s to Start's 5,200, with a first byte of 18 ms to
8.5 ms. It is still 2.8× Next, which pays the same two renders plus its own
overhead. On Bun the gap to Start narrows to 4,400 against 5,200. The
honest reading: for a page that is entirely per-request, Start's single
pass is faster than an RSC pass, and rsc-kit is the fastest of the RSC
frameworks measured. What the two-render model buys is the *other* rows —
the stored page, the shell that paints before the data, and the 81 kB
instead of 108 or 170.

**Opting out of the build costs four times on the page that could have been
stored.** With `prerender: false` the static page renders live at 2,900
req/s and a 16 ms first byte, against 11,700 and 4 ms when stored, and ships
81 kB of runtime it did not need. The per-request page is unchanged, as it
should be. That is why `prerender: false` is for a build machine that cannot
reach the data, and `connection()` — one page, one declaration — is the way
to opt a page out.

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
- Not measured: hydration time, navigation, or anything a browser does.
  `js kB` is the proxy for it.
