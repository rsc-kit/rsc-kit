# rsc-kit.dev

The landing page, built with the framework it describes.

One route, no client components, so the build stores it without the runtime —
the page's own line in the build output is the claim it makes. Deployed as a
Cloudflare Worker; every url the documentation used to live at answers with a
301 to `docs.rsc-kit.dev`.

```sh
npm install
npm run build     # prints:  ○  /  no js
npm run check     # typecheck, lint, and a test through the deployed handler
npx nitro deploy --prebuilt
```

A normal consumer of the published packages, on purpose — `@rsc-kit/core` from
npm, not the workspace — so what this builds is what a user gets.
