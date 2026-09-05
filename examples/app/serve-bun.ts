// The same app, no framework at all.
//
// `rsc-kit/hono` is a 15-line binding; this is what it binds to. Nothing
// below knows about Hono, and nothing in rsc-kit/host knows about Bun.
import { createRscHandler } from '@rsc-kit/core/host'
import { assetsFrom, prerenderedFrom } from '@rsc-kit/core/files'
import * as engine from './build/dist/rsc/index.js'

const rsc = createRscHandler({ engine, assets: assetsFrom('./build/public'),
    // Served from disk when a page was frozen; rendered now when it was not.
    prerendered: prerenderedFrom('./build/static') })

Bun.serve({
  port: 8793,
  fetch: async (request) => (await rsc(request)) ?? new Response('Not found', { status: 404 }),
})

console.log('Bun.serve — http://localhost:8793')
