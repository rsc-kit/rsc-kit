import { Hono } from 'hono'
import { createRscHandler } from '@rsc-router/core/host'
import { assetsFrom, prerenderedFrom } from '@rsc-router/core/files'

// Statically imported, not `import(variable)`: a bundler cannot see through a
// variable, so `bun build --compile` would leave the engine out of the binary.
import * as engine from './build/dist/rsc/index.js'
import { rpcFunctions } from './rpc'

const rsc = createRscHandler({
  engine,
  assets: assetsFrom('./build/public'),
  // Served from disk when a page was frozen; rendered now when it was not.
  prerendered: prerenderedFrom('./build/static'),
  rpc: rpcFunctions,
})

const app = new Hono()

// Anything the manifest does not claim falls through to the app's own routes.
app.get('/health', (c) => c.json({ ok: true }))
app.all('*', async (c) => (await rsc(c.req.raw)) ?? c.notFound())

export default { port: 8792, fetch: app.fetch }
