# rsc-router

React Server Components routing for any JavaScript backend: a Vite plugin that
discovers the route tree, and a host adapter that serves it.

    packages/core     @rsc-router/core — the plugin, the engine, the host adapter
    examples/         the same app on Hono, Bun.serve, Elysia and Cloudflare

A host is a `Request` in and a `Response` out, so binding one to a framework is
a line:

    const rsc = createRscHandler({ engine, assets, rpc })

    app.all('*', async (c) => (await rsc(c.req.raw)) ?? c.notFound())

Nothing in the adapter names a platform module. Reading assets or prerendered
pages is a function the host supplies, so a Worker passes its own binding and
never loads a filesystem.

The protocol between a host and the engine is written down in
[PROTOCOL.md](./PROTOCOL.md). It is the contract the Laravel adapter — which
lives in its own repository, because Packagist expects a repository root —
implements over a socket.
