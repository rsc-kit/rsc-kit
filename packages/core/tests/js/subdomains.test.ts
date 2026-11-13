// rscKit({ subdomains: ['merchant'] }): app/merchant/'s one address is the
// subdomain. The path form on the site's own host is redirected there; the
// subdomain itself, localhost and a preview host are served as before.

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { subdomainRedirect } from '../../src/hostRouting'
import type { RouteManifest } from '../../src/manifest'
import { subdomainPattern, subdomainsProblem } from '../../src/vite'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('subdomains.test.ts')

const s = (value: string) => ({ type: 'static', value }) as const
const own = ['shop.test', 'www.shop.test']

const manifest = {
  version: 'b1',
  build: { hosts: own, subdomains: ['merchant'] },
  // A page under merchant/ is what makes the subdomain routable at all.
  routes: [{ component: 'merchant/page', segments: [s('merchant')], layouts: [], middleware: [] }],
  intercepts: [],
  apis: [
    { name: 'app/merchant/ping/route', segments: [s('merchant'), s('ping')], methods: ['GET', 'POST'], middleware: [] },
    { name: 'app/api/ping/route', segments: [s('api'), s('ping')], methods: ['GET'], middleware: [] },
  ],
} as unknown as RouteManifest

const engine = {
  manifest: () => manifest,
  installHostFn: () => () => {},
  handleApiRoute: async () => new Response('ok'),
}

const handle = createRscHandler({ engine: engine as never })
const ask = (path: string, headers: Record<string, string>, method = 'GET') =>
  handle(new Request('http://127.0.0.1:3000' + path, { method, headers }))

describe('a declared subdomain', () => {
  test("its path form on the site's host is redirected to the subdomain, query kept", async () => {
    const res = await ask('/merchant/ping?x=1', { host: '127.0.0.1:3000', 'x-forwarded-host': 'shop.test', 'x-forwarded-proto': 'https' })

    expect(res!.status).toBe(308)
    expect(res!.headers.get('location')).toBe('https://merchant.shop.test/ping?x=1')
  })

  test('www. is dropped and a port kept', async () => {
    const res = await ask('/merchant/ping', { host: 'www.shop.test:8443' })

    expect(res!.headers.get('location')).toBe('http://merchant.shop.test:8443/ping')
  })

  test('a client navigation is told where to go rather than sent a 308', async () => {
    const res = await ask('/merchant/ping', { host: 'shop.test', 'x-rsc': '1' })

    expect(res!.status).toBe(204)
    expect(res!.headers.get('x-rsc-redirect')).toBe('http://merchant.shop.test/ping')
  })

  test('the subdomain itself is served', async () => {
    const res = await ask('/ping', { host: 'merchant.shop.test' })

    expect(res!.status).toBe(200)
  })

  test('localhost, an ip, a preview host and a post keep the path form', async () => {
    expect((await ask('/merchant/ping', { host: 'localhost:5173' }))!.status).toBe(200)
    expect((await ask('/merchant/ping', { host: '127.0.0.1:3000' }))!.status).toBe(200)
    expect((await ask('/merchant/ping', { host: 'pr-12.shop.test' }))!.status).toBe(200)
    expect((await ask('/merchant/ping', { host: 'shop.test' }, 'POST'))!.status).toBe(200)
  })

  test('a path outside it is untouched', async () => {
    expect((await ask('/api/ping', { host: 'shop.test' }))!.status).toBe(200)
    expect(subdomainRedirect('shop.test', '/merchantx/a', own, ['merchant'])).toBeNull()
  })

  test('its root goes to the subdomain root', () => {
    expect(subdomainRedirect('shop.test', '/merchant', own, ['merchant'])).toEqual({ host: 'merchant.shop.test', pathname: '/' })
  })
})

describe('what the build checks', () => {
  const routes = [{ segments: [s('merchant'), s('onboarding')] }, { segments: [s('about')] }]

  test('a name with no directory, a bad label and no site host are refused', () => {
    expect(subdomainsProblem(['merchnt'], routes, own)).toContain('no page is under app/merchnt/')
    expect(subdomainsProblem(['Merchant'], routes, own)).toContain('not a host label')
    expect(subdomainsProblem(['merchant'], routes, [])).toContain("needs the site's host named")
    expect(subdomainsProblem(['merchant'], routes, own)).toBeNull()
    expect(subdomainsProblem([], routes, [])).toBeNull()
  })

  test('a page under it is also typed by its subdomain url, and others are not', () => {
    expect(subdomainPattern([s('merchant'), s('onboarding')], ['merchant'])).toBe('/onboarding')
    expect(subdomainPattern([s('merchant')], ['merchant'])).toBe('/')
    expect(subdomainPattern([s('about'), s('team')], ['merchant'])).toBeNull()
  })
})
