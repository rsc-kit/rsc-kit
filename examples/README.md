# Examples

    app/           one app, four servers
    cloudflare/    the same app on Workers

## app

The same routes served by Hono (`server.ts`), raw `Bun.serve`
(`serve-bun.ts`) and Elysia (`serve-elysia.ts`). Only the entry file differs
— there is no per-framework adapter, because a host is a `Request` in and a
`Response` out.

    bun run build       # discovers the route tree, writes build/
    bun run prerender   # renders what can be rendered ahead of time
    bun run start       # http://localhost:8792

`bun run build:static` then `bun run export` produces `out/`, a site any file
server can host — including its depth-addressed payloads, so navigating still
keeps the page you came from.

## cloudflare

Needs `app` built first: it imports that engine bundle and serves those
assets. Two settings are required and only one of them fails loudly — see its
README.
