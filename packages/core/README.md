# @rsc-kit/core

React Server Components as a Vite plugin: it discovers the route tree, renders it, and serves it. Nitro builds the server around it, so there is no server file to write.

This is the library. Most people want [`rsc-kit`](https://www.npmjs.com/package/rsc-kit) (the command line) or `bun create rsc-kit@latest` (a new app).

```sh
bun create rsc-kit@latest my-app
```

## Why not just use Next?

That is the right first question, and the honest answer is that the routing
conventions here *are* Next's — `app/`, `page`/`layout`/`loading`, `@slot`,
`(.)` interception, `"use client"`, server actions, `generateMetadata`.
Inventing different names for the same ideas would cost every reader a
translation table and buy nothing.

The difference is what sits underneath.

**It is a Vite plugin, not a bundler.** You keep your `vite.config.ts`, your
plugins, your ecosystem. Adding RSC to an existing app is one entry in the
plugins array — not a migration.

**It runs on your server.** Hono, Elysia, `Bun.serve`, `node:http`,
Cloudflare Workers. The adapter is a `Request` in and a `Response` out, so
binding it is one line and anything it does not claim falls through to your
own routes.

```ts
app.all('*', async (c) => (await rsc(c.req.raw)) ?? c.notFound())
```

**A route can ship no JavaScript at all.** `clientJs = false` renders to HTML
and stops — no bootstrap, no React in the browser, no router. That is about
70 kB gzipped back on a page with nothing to hydrate, of which react-dom alone
is ~54 kB. The build refuses the combination rather than shipping a button that
does nothing.

**And the framework itself is small, because most of what ships is React.**
Measured on the example app: a typical route is 85 kB gzipped, of which
**66 kB is React and react-dom** and this framework's own runtime is 6 kB.
Client components are chunked per module, so a route only downloads the ones it
renders — the three routes using TanStack Query are the only ones that pay for
it. Serving a page frozen at build time costs the server about 25 µs, because
it renders nothing.

**It compiles to a single binary.** `bun build --compile` with the assets and
frozen pages inside it.

## What you get

- File-based routing with layouts, loading boundaries, parallel routes and
  route interception
- Streaming SSR with Suspense, and partial prerendering — the static shell is
  stored, the part that needs the request is rendered per visit
- Server actions, with an optional builder that gives you validation
  (any Standard Schema library — Zod, Valibot, ArkType) and middleware
- API routes in `app/**/route.ts` — a real `Request` in, a real `Response` out,
  frozen at build time when they read nothing from the request
- Typed urls: `params`, `searchParams` and request bodies arrive parsed through
  a schema you export beside the route
- Typed routes: every build writes the routes it found, so a link to a page
  that does not exist stops compiling
- `middleware.ts` that runs before every render below it, on every path
- Request and response access — `headers()`, `cookies()`, `responseHeaders()`
- Offline and installable: a generated service worker, a web manifest, icons
  found by name, and a place to put your own push handlers
- A build that explains itself — why each route is dynamic, what it ships, and
  a report an `@rsc-kit/mcp` server can answer questions from

## Status

**0.x. Early, and honest about it.** The API will change before 1.0, and
`@vitejs/plugin-rsc` — which this builds on — is itself pre-1.0.

It is tested (500+ tests across the engine, the client router and the build),
it has had an adversarial security review, and it runs a real documentation
site in production. It has not been used by anyone but its author. Issues and
questions are welcome; promises are not being made yet.

See [SECURITY.md](./SECURITY.md) for the threat model and how to report
something.

## Getting started

```sh
bun create rsc-kit@latest my-app   # a new app
cd my-app && bun run dev
```

Adding it to a project you already have:

```sh
bunx create-rsc-kit@latest --init
```

Docs: https://docs.rsc-kit.dev

## Licence

MIT
