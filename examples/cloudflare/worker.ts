// The example app, on Cloudflare Workers.
//
// It renders the same app as ../app — build that first (`bun run build` there),
// since this imports its engine bundle and serves its assets.
//
// Does the RSC engine run on workerd?
//
// The adapter names no platform module, but the engine bundle does — so this
// is really a test of whether @vitejs/plugin-rsc's output loads under
// nodejs_compat, and whether the SSR half can be reached from it.
import { createRscHandler } from '@rsc-kit/core/host'
import * as engine from '../app/build/dist/rsc/index.js'

const rsc = createRscHandler({
  engine: engine as never,
  // No filesystem here. Assets come from the platform's own binding, which is
  // the case the reader contract exists for.
  assets: async (pathname, request) => {
    if (!pathname.startsWith('/assets/')) return null

    return await (globalThis as any).__ASSETS.fetch(request)
  },
})

export default {
  async fetch(request: Request, env: { ASSETS: { fetch: (r: Request) => Promise<Response> } }) {
    ;(globalThis as any).__ASSETS = env.ASSETS

    return (await rsc(request)) ?? new Response('Not found', { status: 404 })
  },
}
