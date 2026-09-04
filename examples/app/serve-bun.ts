// The same app, no framework at all.
//
// `rsc-router/hono` is a 15-line binding; this is what it binds to. Nothing
// below knows about Hono, and nothing in rsc-router/host knows about Bun.
import { createRscHandler } from '@rsc-router/core/host'
import { assetsFrom, prerenderedFrom } from '@rsc-router/core/files'
import * as engine from './build/dist/rsc/index.js'
import { rpcFunctions } from './rpc'

const rsc = createRscHandler({ engine, assets: assetsFrom('./build/public'),
    // Served from disk when a page was frozen; rendered now when it was not.
    prerendered: prerenderedFrom('./build/static'), rpc: rpcFunctions })

Bun.serve({
  port: 8793,
  fetch: async (request) => (await rsc(request)) ?? new Response('Not found', { status: 404 }),
})

console.log('Bun.serve — http://localhost:8793')
