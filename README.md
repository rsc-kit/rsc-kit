# rsc-kit

React Server Components as a Vite plugin, on any JavaScript server.

```sh
bun create rsc-kit my-app
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
Measured on the example app: 74.7 kB gzipped of JavaScript, of which this
framework's own runtime is 17 kB — 7.3%. React, react-dom, the Flight client
and the scheduler are 90%. Serving a page frozen at build time costs the
server about 25 µs, because it renders nothing; the host adapter costs about
9 µs per request. Both are handler time, not what a browser sees — the network
dominates that.

**It compiles to a single binary.** `bun build --compile` with the assets and
frozen pages inside it.

**And it is not only JavaScript.** The same engine drives a Laravel host over a
socket, which is where this started.

## What you get

- File-based routing with layouts, loading boundaries, parallel routes and
  route interception
- Streaming SSR with Suspense, and partial prerendering — the static shell is
  stored, the part that needs the request is rendered per visit
- Server actions, with an optional builder that gives you validation
  (any Standard Schema library — Zod, Valibot, ArkType) and middleware
- Typed routes: every build writes the routes it found, so a link to a page
  that does not exist stops compiling
- `middleware.ts` that runs before every render below it, on every path
- Request and response access — `headers()`, `cookies()`, `responseHeaders()`

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
bun create rsc-kit my-app     # a new app
cd my-app && bun run dev
```

Adding it to a project you already have:

```sh
bunx create-rsc-kit --init
```

Docs: https://rsc-kit.dev

## Licence

MIT
