#!/usr/bin/env bun
// What rsc-kit's own client runtime costs a page, gzipped - and a limit it
// may not pass without someone deciding it should.
//
// The runtime is everything a page with an interactive component loads from
// rsc-kit itself: the router, the segment store, prefetch, the payload glue.
// React, React DOM and React's payload decoder are left out - they are the
// same size whatever this project does. Bundled on its own, from the built
// package, so the number does not depend on any app.
//
// It grew from about 6 kB to over 10 without anyone noticing. Passing the
// limit fails CI; raising it is a line in this file, in a pull request,
// where it is a decision rather than a drift.
//
//   bun scripts/runtime-size.mjs        # after `bun run --filter @rsc-kit/core build`

import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const LIMIT_GZIP = 11_500

const entry = join(import.meta.dir, '../packages/core/dist/js/createViteRscApp.js')
const result = await Bun.build({
  entrypoints: [entry],
  target: 'browser',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', 'react-server-dom-webpack*', '@vitejs/plugin-rsc*', 'virtual:*'],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const code = new Uint8Array(await result.outputs[0].arrayBuffer())
const gzip = gzipSync(code, { level: 9 }).length
const kb = (n) => (n / 1000).toFixed(1) + ' kB'

console.log(`rsc-kit client runtime: ${kb(code.length)} minified, ${kb(gzip)} gzipped (limit ${kb(LIMIT_GZIP)})`)

if (gzip > LIMIT_GZIP) {
  console.error(
    `\nThe runtime is ${kb(gzip - LIMIT_GZIP)} over its limit. Every page with an interactive ` +
      'component loads it. Make it smaller, load the new part only where it is used, or raise ' +
      'LIMIT_GZIP in scripts/runtime-size.mjs and say why in the pull request.',
  )
  process.exit(1)
}
