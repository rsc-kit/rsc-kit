// A subdomain of the site that no route begins with is served by path. The
// dev server is told, so the home page on merchant.example.test is not a
// mystery; a foreign host - a proxy's internal name - is not reported.

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { unroutedHostMessage } from '../../src/hostRouting'
import type { RouteManifest } from '../../src/manifest'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('unroutedHost.test.ts')

const manifest = {
  version: 'b1',
  build: { hosts: ['shop.test', 'www.shop.test'] },
  routes: [],
  intercepts: [],
  apis: [{ name: 'app/api/ping/route', segments: [{ type: 'static', value: 'api' }, { type: 'static', value: 'ping' }], methods: ['GET'], middleware: [] }],
} as unknown as RouteManifest

const engine = {
  manifest: () => manifest,
  installHostFn: () => () => {},
  handleApiRoute: async () => new Response('ok'),
}

const told: [string, string][] = []
const handle = createRscHandler({ engine: engine as never, onUnroutedHost: (host, segment) => told.push([host, segment]) })
const ask = (headers: Record<string, string>) => handle(new Request('http://127.0.0.1:3000/api/ping', { headers }))

describe('a subdomain no route begins with', () => {
  test('is served by path, and the dev hook is told which host and folder', async () => {
    told.length = 0

    const res = await ask({ host: '127.0.0.1:3000', 'x-forwarded-host': 'merchant.shop.test' })

    expect(res!.status).toBe(200)
    expect(told).toEqual([['merchant.shop.test', 'merchant']])
  })

  test("is not reported for the site's own host or a foreign one", async () => {
    told.length = 0

    await ask({ host: 'shop.test' })
    await ask({ host: 'www.shop.test' })
    await ask({ host: 'renderer:3000' })
    await ask({ host: 'acme.com' })

    expect(told).toEqual([])
  })

  test('the message names the folder to add', () => {
    expect(unroutedHostMessage('merchant.shop.test:443', 'merchant')).toBe(
      "[rsc-kit] merchant.shop.test has no app/merchant/ - served by path, as the site's own. Add app/merchant/ to route the subdomain there.",
    )
  })
})
