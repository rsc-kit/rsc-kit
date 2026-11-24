// The browser posts an action to /_rsc/action whatever host its page is on, so
// the endpoints are matched without the host's segment in front. With it,
// merchant.shop.test/_rsc/action was /merchant/_rsc/action, which nothing
// answers: every action on a subdomain was a 404.

import { beforeEach, describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import type { RouteManifest } from '../../src/manifest'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('hostEndpoints.test.ts')

const page = (name: string, segments: { type: string; value: string }[]) => ({
  name,
  component: name,
  segments,
  layouts: [],
  loadings: [],
  slots: {},
  middleware: [],
})
const at = (value: string) => ({ type: 'static', value })

const manifest = {
  version: 'b1',
  build: { hosts: ['shop.test', 'www.shop.test'] },
  routes: [
    page('app/login/page', [at('login')]),
    page('app/merchant/login/page', [at('merchant'), at('login')]),
    page('app/[domain]/login/page', [{ type: 'host', value: 'domain' }, at('login')]),
  ],
  intercepts: [],
  apis: [],
} as unknown as RouteManifest

let from: { component?: string; props?: Record<string, unknown> } | undefined
let ran: string[]

beforeEach(() => {
  from = undefined
  ran = []
})

const handle = createRscHandler({
  engine: {
    manifest: () => manifest,
    installHostFn: () => () => {},
    handleAction: async (id: string, _body: unknown, _type: string, current: never) => {
      ran.push(id)
      from = current

      return { stream: new Blob(['0:null']).stream() }
    },
    handleQuery: async (id: string) => {
      ran.push(id)

      return { stream: new Blob(['0:null']).stream(), cacheControl: 'no-store' }
    },
  } as never,
})

const post = (headers: Record<string, string>, origin = 'http://127.0.0.1:3000') =>
  handle(
    new Request(`${origin}/_rsc/action`, {
      method: 'POST',
      headers: { 'X-RSC-Action': 'file#login', 'X-RSC-Referer': '/login', 'Sec-Fetch-Site': 'same-origin', ...headers },
      body: '[]',
    }),
  )

describe('on a host that is a route segment', () => {
  for (const [what, host] of [
    ['a subdomain with a directory', 'merchant.shop.test'],
    ['a subdomain bound by [domain]', 'acme.shop.test'],
    ['a custom domain', 'acme.com'],
  ]) {
    test(`an action is answered on ${what}`, async () => {
      expect((await post({ host }))?.status).toBe(200)
      expect(ran).toEqual(['file#login'])
    })
  }

  test('and behind a proxy that names the host in X-Forwarded-Host', async () => {
    expect((await post({ 'x-forwarded-host': 'merchant.shop.test' }))?.status).toBe(200)
  })

  test('a query is answered', async () => {
    const res = await handle(
      new Request('http://127.0.0.1:3000/_rsc/query?id=file%23read&args=%5B%5D', {
        headers: { host: 'merchant.shop.test', 'X-RSC-Query': '1' },
      }),
    )

    expect(res?.status).toBe(200)
    expect(ran).toEqual(['file#read'])
  })

  test('health and the changes stream are found', async () => {
    const health = await handle(new Request('http://127.0.0.1:3000/_rsc/health', { headers: { host: 'merchant.shop.test' } }))
    const changes = await handle(new Request('http://127.0.0.1:3000/_rsc/changes', { headers: { host: 'merchant.shop.test' } }))

    expect(health).not.toBeNull()
    expect(changes).not.toBeNull()
  })

  test('a cross-site post is still refused', async () => {
    expect((await post({ host: 'merchant.shop.test', 'Sec-Fetch-Site': 'cross-site' }))?.status).toBe(403)
    expect(ran).toEqual([])
  })
})

describe('the page an action came from', () => {
  test("is the subdomain's, though the proxy reaches this process by address", async () => {
    await post({ 'x-forwarded-host': 'merchant.shop.test' })

    expect(from?.component).toBe('app/merchant/login/page')
  })

  test('binds the host for [domain]', async () => {
    await post({ host: 'acme.shop.test' })

    expect(from?.component).toBe('app/[domain]/login/page')
    expect(from?.props).toMatchObject({ domain: 'acme' })
  })

  test("is the site's on its own host", async () => {
    await post({ host: 'shop.test' })

    expect(from?.component).toBe('app/login/page')
  })
})
