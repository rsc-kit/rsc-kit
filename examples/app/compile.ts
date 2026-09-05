// Build the single-file binary. Run after `bun run build` and `bun run prerender`.
//
// Nothing here is an entry point: the assets module and the server entry are
// both generated, because an entry that imports embedded files is Bun-only and
// this app also runs on Node, Elysia and Workers.
import { compile } from '@rsc-kit/core/compile'

await compile({
  engine: './build/dist/rsc/index.js',
  assets: './build/public/assets',
  prerendered: './build/static',
  outfile: './rsc-app',
  port: 8792,
})
