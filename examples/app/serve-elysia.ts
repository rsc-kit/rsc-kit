// The same app again, on Elysia — a third framework, no new adapter code.
//
// `rsc-router/host` takes a Request and returns a Response, so binding it is
// a matter of handing over `request` and letting anything it does not claim
// fall through to the framework's own routes.
import { Elysia } from 'elysia'
import { createRscHandler } from '@rsc-router/core/host'
import { assetsFrom, prerenderedFrom } from '@rsc-router/core/files'
import * as engine from './build/dist/rsc/index.js'
import { rpcFunctions } from './rpc'

const rsc = createRscHandler({
  engine,
  assets: assetsFrom('./build/public'),
  prerendered: prerenderedFrom('./build/static'),
  rpc: rpcFunctions,
})

new Elysia()
  .get('/health', () => ({ ok: true }))
  .all('*', async ({ request, status }) => (await rsc(request)) ?? status(404, 'Not found'))
  .listen(8796)

console.log('Elysia — http://localhost:8796')
