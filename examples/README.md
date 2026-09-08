# Examples

    app/    the app, built and served the way every scaffolded app is

## app

The full route tree — parallel slots, an interception, route middleware,
server actions, a stored redirect, and pages across all three prerender
classifications.

    bun install
    bun run dev      # vite, no build step
    bun run build    # bundles, freezes what it can, writes .output/
    bun run start    # bun .output/server/index.mjs

There is no server file. `vite.config.ts` names a Nitro preset and the server
is built around the route tree; changing where it deploys is changing that one
string.

`RSC_OUTPUT=export bun run build` writes `dist/` instead — a site any file
server can host, including its depth-addressed payloads, so navigating still
keeps the page you came from.

CI asserts what the build froze (`9 static, 3 partial prerender`) and then
serves `.output/` and checks it back. A page that quietly stops being
prerendered still works; it just renders again for every visitor, and nothing
else would report it.
