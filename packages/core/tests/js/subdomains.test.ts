// rscKit({ subdomains }) makes a directory's subdomain its only url: the path
// form on the site's own host is sent there, and a redirect to a path under
// it - or to the site from it - names the host it belongs on.

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { siteFromRequest, subdomainHref, subdomainRedirect } from '../../src/hostRouting'
import type { RouteManifest } from '../../src/manifest'
import { backendPathOnSubdomain, normaliseSubdomains, subdomainProblem } from '../../src/vite'
import { visitorPaths } from '../../src/purge'
import { edgeShells, edgeStatic } from '../../src/edgeShells'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('subdomains.test.ts')

const own = ['shop.test', 'www.shop.test']
const api = (segments: string[]) => ({
  name: `app/${segments.join('/')}/route`,
  segments: segments.map((value) => ({ type: 'static', value })),
  methods: ['GET', 'POST'],
  middleware: [],
})

const manifest = {
  version: 'b1',
  build: { hosts: own, subdomains: ['merchant'] },
  // A page under app/merchant, which is what routes the subdomain there.
  routes: [{ name: 'app/merchant/dashboard/page', segments: [{ type: 'static', value: 'merchant' }, { type: 'static', value: 'dashboard' }], layouts: [], middleware: [] }],
  intercepts: [],
  apis: [api(['merchant', 'go']), api(['merchant', 'home']), api(['merchant', 'ping'])],
} as unknown as RouteManifest

const engine = {
  manifest: () => manifest,
  installHostFn: () => () => {},
  handleApiRoute: async (name: string) =>
    name === 'app/merchant/go/route'
      ? new Response(null, { status: 302, headers: { Location: '/merchant/onboarding?step=2' } })
      : name === 'app/merchant/home/route'
        ? new Response(null, { status: 302, headers: { Location: '/pricing' } })
        : new Response('ok'),
}

const handle = createRscHandler({ engine: engine as never })
const ask = (path: string, headers: Record<string, string>, method = 'GET') =>
  handle(new Request(`http://127.0.0.1:3000${path}`, { method, headers }))

describe('the path form of a subdomain page', () => {
  test("answers 301 to the subdomain on the site's own host, query kept", async () => {
    const res = await ask('/merchant/ping?a=1', { host: 'shop.test', 'x-forwarded-proto': 'https' })

    expect(res!.status).toBe(301)
    expect(res!.headers.get('location')).toBe('https://merchant.shop.test/ping?a=1')
  })

  test('from www and for the directory itself', async () => {
    const res = await ask('/merchant', { host: 'www.shop.test:8443' })

    expect(res!.headers.get('location')).toBe('http://merchant.shop.test:8443/')
  })

  test('is still served on localhost, an address, a payload request and a POST', async () => {
    expect((await ask('/merchant/ping', { host: 'localhost:3000' }))!.status).toBe(200)
    expect((await ask('/merchant/ping', { host: '127.0.0.1:3000' }))!.status).toBe(200)
    expect((await ask('/merchant/ping', { host: 'shop.test', 'x-rsc': '1' }))!.status).not.toBe(301)
    expect((await ask('/merchant/ping', { host: 'shop.test' }, 'POST'))!.status).toBe(200)
  })

  // Homeport's <app>.homeport.run, a preview, a deploy's internal name: none
  // is the site's host, so none has a merchant. of its own to send anyone to.
  test("is served by path on any host that is not the site's", async () => {
    expect((await ask('/merchant/ping', { host: 'acme.homeport.run' }))!.status).toBe(200)
    expect((await ask('/merchant/ping', { host: 'pr-12.shop.test' }))!.status).toBe(200)
  })

  test('is served on its subdomain', async () => {
    expect((await ask('/ping', { host: 'merchant.shop.test' }))!.status).toBe(200)
  })
})

describe('a redirect answered on the subdomain', () => {
  test('to a path under it names the subdomain, without the directory', async () => {
    const res = await ask('/go', { host: 'merchant.shop.test' })

    expect(res!.headers.get('location')).toBe('//merchant.shop.test/onboarding?step=2')
  })

  test('to any other root path names the site', async () => {
    const res = await ask('/home', { host: 'merchant.shop.test:8443' })

    expect(res!.headers.get('location')).toBe('//shop.test:8443/pricing')
  })
})

describe('placing an href', () => {
  test('a path under a subdomain directory is that subdomain, the same string everywhere', () => {
    expect(subdomainHref('/merchant/orders', ['merchant'], 'shop.test')).toBe('//merchant.shop.test/orders')
    expect(subdomainHref('/merchant', ['merchant'], 'shop.test')).toBe('//merchant.shop.test/')
    expect(subdomainHref('/merchant?tab=1', ['merchant'], 'shop.test')).toBe('//merchant.shop.test/?tab=1')
    expect(subdomainHref('/merchants', ['merchant'], 'shop.test')).toBe('/merchants')
  })

  test('a root path on the subdomain is the site, once the host is known', () => {
    expect(subdomainHref('/pricing', ['merchant'], 'shop.test', 'merchant.shop.test')).toBe('//shop.test/pricing')
    expect(subdomainHref('/pricing', ['merchant'], 'shop.test', 'shop.test')).toBe('/pricing')
    expect(subdomainHref('/pricing', ['merchant'], 'shop.test')).toBe('/pricing')
  })

  test('moves nothing on a host that is neither the site nor a named subdomain', () => {
    for (const host of ['acme.homeport.run', 'pr-12.shop.test', 'localhost:5173']) {
      expect(subdomainHref('/merchant/orders', ['merchant'], 'shop.test', host)).toBe('/merchant/orders')
      expect(subdomainHref('/pricing', ['merchant'], 'shop.test', host)).toBe('/pricing')
    }
    expect(subdomainHref('/merchant/orders', ['merchant'], 'shop.test', 'www.shop.test')).toBe('//merchant.shop.test/orders')
  })

  test('leaves what is not a root path, and everything when none are named', () => {
    for (const href of ['//acme.com/x', 'https://acme.com', '#top', 'orders', '?q=1']) {
      expect(subdomainHref(href, ['merchant'], 'shop.test', 'merchant.shop.test')).toBe(href)
    }
    expect(subdomainHref('/merchant/orders', [], 'shop.test')).toBe('/merchant/orders')
    expect(subdomainHref('/merchant/orders', ['merchant'], null)).toBe('/merchant/orders')
  })

  test('the redirect and the site are read from the request host', () => {
    expect(subdomainRedirect('shop.test', '/merchant/x', own, ['merchant'])).toBe('merchant.shop.test/x')
    expect(subdomainRedirect('acme.com', '/merchant/x', own, ['merchant'])).toBeNull()
    expect(siteFromRequest('merchant.shop.test:8443', own, ['merchant'])).toBe('shop.test:8443')
    expect(siteFromRequest('www.shop.test', own, ['merchant'])).toBe('shop.test')
    expect(siteFromRequest('acme.com', own, ['merchant'])).toBeNull()
  })
})

describe('the option', () => {
  test('takes labels, with or without a slash, and refuses anything else', () => {
    expect(normaliseSubdomains(['merchant', '/admin/', 'merchant'])).toEqual(['merchant', 'admin'])
    expect(normaliseSubdomains(undefined)).toEqual([])
    expect(() => normaliseSubdomains(['Merchant'])).toThrow('is not a subdomain label')
    expect(() => normaliseSubdomains(['a/b'])).toThrow('is not a subdomain label')
    expect(() => normaliseSubdomains(['www'])).toThrow("'www' is the site's own host")
  })

  test('needs the site host and a directory to serve', () => {
    const routes = [{ component: 'app/merchant/orders/page', segments: [{ type: 'static', value: 'merchant' }, { type: 'static', value: 'orders' }] }] as never

    expect(subdomainProblem(routes, ['merchant'], true)).toBeNull()
    expect(subdomainProblem(routes, [], false)).toBeNull()
    expect(subdomainProblem(routes, ['merchant'], false)).toContain('rscKit({ hosts')
    expect(subdomainProblem(routes, ['admin'], true)).toContain('add app/admin/page.tsx')
  })
})

describe('what a platform in front is told', () => {
  test('a purge of a path under the folder names the path visitors use too', () => {
    expect(visitorPaths(['/merchant/orders', '/merchant', '/pricing'], ['merchant'])).toEqual(['/merchant/orders', '/merchant', '/pricing', '/orders', '/'])
    expect(visitorPaths(['/merchant/orders'], [])).toEqual(['/merchant/orders'])
  })

  test('edge.json lists no page under the folder, which an edge would answer by path and skip the 301', () => {
    const st = (value: string) => ({ type: 'static' as const, value })
    const routes = [
      { component: 'app/merchant/orders/page', segments: [st('merchant'), st('orders')] },
      { component: 'app/pricing/page', segments: [st('pricing')] },
    ]

    expect(edgeShells(routes.map((r) => ({ type: 'shell', component: r.component })), routes, ['merchant']).shells).toEqual(['/pricing'])
    expect(
      edgeStatic(
        [
          { type: 'frozen', component: 'app/merchant/orders/page', url: '/merchant/orders' },
          { type: 'frozen', component: 'app/pricing/page', url: '/pricing' },
        ],
        routes,
        [],
        ['merchant'],
      ).static,
    ).toEqual(['/pricing'])
  })

  test('a backend path under the folder stops the build: visitors there never send it', () => {
    expect(backendPathOnSubdomain(['/merchant/auth'], ['merchant'])).toContain('its visitors send "/auth"')
    expect(backendPathOnSubdomain(['/auth', '/merchants'], ['merchant'])).toBeNull()
  })
})
