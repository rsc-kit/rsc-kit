# rsc-kit

React Server Components as a Vite plugin, deployed wherever Nitro deploys —
with or without a backend behind it.

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

**It deploys wherever you like.** [Nitro](https://nitro.build) builds the
server around your route tree, so the target is a preset — Bun, Node, Workers,
Vercel, Netlify, Deno — and not an adapter package this project has to write.

```ts
nitro({ preset: 'cloudflare_module' })
```

**There is no server file.** A generated app has none to write or maintain.
The preset is the deployment.

**A page ships no JavaScript until something on it needs some.** A route that
freezes whole, renders no client component and has no server action in its
tree is stored as HTML and stops — no bootstrap, no React in the browser, no
router. `"use client"` is the opt-in, and there is no switch beside it
([guide](https://docs.rsc-kit.dev/guides/no-javascript)).

**And the framework itself is small, because most of what ships is React.**
Measured on the example app: 74.7 kB gzipped of JavaScript, of which this
framework's own runtime is 17 kB — 7.3%. React, react-dom, the Flight client
and the scheduler are 90%. Serving a page frozen at build time costs the
server about 25 µs, because it renders nothing. That is handler time, not what
a browser sees — the network dominates that.

**It compiles to a single binary.** `bun build --compile` with the assets and
frozen pages inside it.

**And it can sit in front of a backend you already have.** With Laravel or Go
behind it, the app is a BAP —
[Backend-Answered Pages](https://docs.rsc-kit.dev/hosts/backend-answered-pages):
the renderer owns routing and rendering, and a server component asks the
backend for data with `await rpc('Orders.recent')`. The backend answers one
private endpoint, `POST /__rsc/host-call`.

## What you get

- File-based routing with layouts (which receive `params`), loading
  boundaries, parallel routes and route interception
- Streaming SSR with Suspense, and partial prerendering — the static shell is
  stored, the part that needs the request is rendered per visit
- Server actions, with an optional builder that gives you validation
  (any Standard Schema library — Zod, Valibot, ArkType) and middleware;
  `<Form>` and `useAction` on the client
- Typed routes: every build writes the routes it found, so a link to a page
  that does not exist stops compiling
- `middleware.ts` that runs before every render below it, on every path
- Request and response access — `headers()`, `cookies()`, `responseHeaders()`
- Backends as adapters: [Laravel](https://docs.rsc-kit.dev/hosts/laravel)
  (`rsc-kit/laravel`) and [Go](https://docs.rsc-kit.dev/hosts/go)
  (`github.com/rsc-kit/go`), with `rpc()` calls and action stubs typed from
  the backend's own signatures. Another backend implements
  [one endpoint](https://docs.rsc-kit.dev/hosts/your-own-backend) and checks
  itself with `rsc-kit-conformance`.
- Testing without a browser: `createTestApp()` from `@rsc-kit/core/testing`
  fetches any url, with a fake backend if you have one
  ([guide](https://docs.rsc-kit.dev/guides/testing))

## Packages

| Package | What it is |
| --- | --- |
| [`@rsc-kit/core`](./packages/core) | The Vite plugin, render engine and client runtime |
| [`create-rsc-kit`](./packages/create) | `bun create rsc-kit` — scaffolds a new app |
| [`rsc-kit`](./packages/cli) | The command line: `init` and `typegen` |
| [`@rsc-kit/mcp`](./packages/mcp) | An MCP server over your build and the guides |

## Status

**0.x. Early, and honest about it.** The API will change before 1.0, and
`@vitejs/plugin-rsc` — which this builds on — is itself pre-1.0.

It is tested (over a thousand tests across the engine, the client router and
the build), it has had an adversarial security review, and it runs a real
documentation site in production. It has not been used by anyone but its
author. Issues and questions are welcome; promises are not being made yet.

See [SECURITY.md](./SECURITY.md) for the threat model and how to report
something.

## Getting started

```sh
bun create rsc-kit@latest my-app   # a new app
cd my-app && bun run dev
```

Adding it to a project you already have, including a Go module:

```sh
bunx rsc-kit@latest init
```

In a Laravel app, `composer require rsc-kit/laravel && php artisan rsc:install`
does both halves.

Docs: https://docs.rsc-kit.dev

## Licence

MIT
