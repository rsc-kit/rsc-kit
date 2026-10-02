# @rsc-kit/core

React Server Components as a Vite plugin: it discovers the route tree, renders it, and serves it. Nitro builds the server around it, so there is no server file to write.

This is the library. Most people start with `bun create rsc-kit@latest my-app` (a new app) or `bunx rsc-kit@latest init` (an existing project).

```sh
bun create rsc-kit@latest my-app
```

## Why not just use Next?

The routing conventions here *are* Next's — `app/`, `page`/`layout`/`loading`,
`@slot`, `(.)` interception, `"use client"`, server actions,
`generateMetadata` — so there is no translation table to learn. The difference
is underneath:

- **It is a Vite plugin, not a bundler.** You keep your `vite.config.ts` and
  your plugins. Adding RSC is one entry in the plugins array.
- **It deploys wherever Nitro does.** [Nitro](https://nitro.build) builds the
  server around the route tree, so the target is a preset — Bun, Node,
  Cloudflare Workers, Vercel, Netlify, Deno.
- **A page ships no JavaScript until something on it needs some.** No client
  component and no server action in its tree means stored HTML, with no React
  in the browser ([guide](https://docs.rsc-kit.dev/guides/no-javascript)).
- **It can sit in front of a backend you already have.** With Laravel or Go
  behind it, a server component calls the backend with
  `await rpc('Orders.recent')`, typed from the backend's own signatures. See
  [Backend-Answered Pages](https://docs.rsc-kit.dev/hosts/backend-answered-pages).
- **It compiles to a single binary** with `bun build --compile`, assets and
  frozen pages inside it.

## Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { nitro } from 'nitro/vite'
import react from '@vitejs/plugin-react'
import { rscKit } from '@rsc-kit/core/vite'

export default defineConfig({
  plugins: [nitro({ preset: 'bun', serveStatic: 'inline' }), rscKit(), react()],
})
```

React 19.2+ and Vite 8 are peer dependencies. The full walk-through is
[Installation](https://docs.rsc-kit.dev/installation).

With a backend, `rscKit({ hostManifest: { command, cwd, watch } })` runs the
backend's manifest command — `php artisan rsc:host-manifest`, or a Go program
calling `reg.WriteManifest` — when dev or a build starts, and again under dev
when something in a `watch` directory changes. It writes `rsc-host.json`
(`{ actions, functions, types, defs }`), from which the build generates typed
`rpc()` overloads and server action stubs.

## What you get

- File-based routing with layouts (which receive `params`), loading
  boundaries, parallel routes and route interception
- Streaming SSR with Suspense, and partial prerendering — the static shell is
  stored, the part that needs the request is rendered per visit
- Server actions, with an optional builder (`@rsc-kit/core/action`) for
  validation (any Standard Schema library — Zod, Valibot, ArkType) and
  middleware; `<Form>` with field errors and `formError`, and `useAction` for
  calls without a form
- API routes in `app/**/route.ts` — a `Request` in, a `Response` out, frozen
  at build time when they read nothing from the request
- Typed urls: `params`, `searchParams` and request bodies arrive parsed through
  a schema you export beside the route
- Typed routes: every build writes the routes it found, so a link to a page
  that does not exist stops compiling
- `middleware.ts` that runs before every render below it; `notFound()` there
  answers 404
- Request and response access — `headers()`, `cookies()`, `responseHeaders()`
- Offline and installable: a generated service worker, a web manifest, icons
  found by name, and a place to put your own push handlers
- Testing without a browser: `createTestApp({ host, backend })` from
  `@rsc-kit/core/testing` fetches any url, with `hostReply` to fake backend
  answers ([guide](https://docs.rsc-kit.dev/guides/testing))
- A build that explains itself — why each route is dynamic, what it ships, and
  a `build-report.json` that [`@rsc-kit/mcp`](https://www.npmjs.com/package/@rsc-kit/mcp)
  answers questions from

## Commands

- `rsc-kit-typegen` writes the generated types without starting Vite;
  `--check` exits non-zero when the committed `rsc-host.json` or types are
  stale ([typed routes](https://docs.rsc-kit.dev/guides/typed-routes)).
- `rsc-kit-conformance` checks a backend adapter against the host-call
  contract ([your own backend](https://docs.rsc-kit.dev/hosts/your-own-backend)):

  ```sh
  npx -y -p @rsc-kit/core rsc-kit-conformance \
    --endpoint http://127.0.0.1:8123/__rsc/host-call --secret test --manifest rsc-host.json
  ```

## Status

**0.x.** The API will change before 1.0, and `@vitejs/plugin-rsc` — which
this builds on — is itself pre-1.0. It has had an adversarial security review
and runs a real documentation site in production. See
[SECURITY.md](./SECURITY.md) for the threat model and how to report something.

Docs: https://docs.rsc-kit.dev

## Licence

MIT
