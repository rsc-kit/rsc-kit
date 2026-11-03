// A route.ts that changes something, posted to from another site.
//
// Unlike an action it needs no custom header, so a browser sends a
// cross-site POST without a preflight - with the visitor's cookies. The
// handler must never run for one; a webhook, which is not a browser, must.

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import type { RouteManifest } from '../../src/manifest'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('apiRouteOrigin.test.ts')

const manifest = {
  version: 'b1',
  routes: [],
  intercepts: [],
  apis: [
    { name: 'app/api/orders/route', segments: [{ type: 'static', value: 'api' }, { type: 'static', value: 'orders' }], methods: ['GET', 'POST', 'DELETE'], middleware: [] },
  ],
} as unknown as RouteManifest

let ran = 0

const engine = {
  manifest: () => manifest,
  installHostFn: () => () => {},
  async handleApiRoute() {
    ran++

    return new Response('ok')
  },
}

const handle = (trustedOrigins?: string[]) => createRscHandler({ engine: engine as never, trustedOrigins })

const ask = (method: string, headers: Record<string, string>, trustedOrigins?: string[]) =>
  handle(trustedOrigins)(new Request('https://shop.test/api/orders', { method, headers: { host: 'shop.test', ...headers } }))

describe('a route.ts that changes something', () => {
  test('refuses a browser posting from another site, before the handler runs', async () => {
    ran = 0

    for (const method of ['POST', 'DELETE']) {
      const res = await ask(method, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', cookie: 'session=abc' })

      expect(res!.status).toBe(403)
    }

    // An older browser with no Sec-Fetch-Site, judged by Origin.
    expect((await ask('POST', { origin: 'https://evil.example' }))!.status).toBe(403)
    expect(ran).toBe(0)
  })

  test('answers its own site, and a caller that is not a browser', async () => {
    expect((await ask('POST', { 'sec-fetch-site': 'same-origin', origin: 'https://shop.test' }))!.status).toBe(200)
    expect((await ask('POST', { origin: 'https://shop.test' }))!.status).toBe(200)
    // A webhook: no Sec-Fetch-Site, no Origin.
    expect((await ask('POST', { 'content-type': 'application/json' }))!.status).toBe(200)
  })

  test('answers a site it was told to trust', async () => {
    const res = await ask('POST', { 'sec-fetch-site': 'cross-site', origin: 'https://admin.example.com' }, ['https://admin.example.com'])

    expect(res!.status).toBe(200)
  })

  test('is read from anywhere: a GET changes nothing', async () => {
    expect((await ask('GET', { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }))!.status).toBe(200)
  })
})

describe('trustedOrigins', () => {
  test('must be origins, said at start rather than never matching', () => {
    expect(() => handle(['https://admin.example.com/'])).not.toThrow()

    for (const bad of ['admin.example.com', 'https://admin.example.com/panel', '*']) {
      expect(() => handle([bad])).toThrow('is not an origin')
    }
  })
})
