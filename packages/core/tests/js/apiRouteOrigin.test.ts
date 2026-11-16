// A route.ts that changes something, posted to from another site.
//
// Unlike an action it needs no custom header, so a browser sends a
// cross-site POST without a preflight - with the visitor's cookies. The
// handler must never run for one; a webhook, which is not a browser, must.

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import type { RouteManifest } from '../../src/manifest'
import { assertServerRuntime } from './serverRuntime'
import { cookies, headers as requestHeaders } from '../../src/request'
import { crossOriginOf } from '../../src/vite'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

assertServerRuntime('apiRouteOrigin.test.ts')

const manifest = {
  version: 'b1',
  routes: [],
  intercepts: [],
  apis: [
    { name: 'app/api/orders/route', segments: [{ type: 'static', value: 'api' }, { type: 'static', value: 'orders' }], methods: ['GET', 'POST', 'DELETE'], middleware: [] },
    { name: 'app/api/v1/chat/route', segments: [{ type: 'static', value: 'api' }, { type: 'static', value: 'v1' }, { type: 'static', value: 'chat' }], methods: ['POST'], middleware: [], crossOrigin: true },
  ],
} as unknown as RouteManifest

let ran = 0
let seen: { cookie: string | null; read: string | null; requestCookie: string | null; authorization: string | null } | null = null

const engine = {
  manifest: () => manifest,
  installHostFn: () => () => {},
  async handleApiRoute(_name: string, request: Request) {
    ran++
    seen = {
      cookie: (await requestHeaders()).get('cookie'),
      read: (await cookies()).get('session')?.value ?? null,
      requestCookie: request.headers.get('cookie'),
      authorization: request.headers.get('authorization'),
    }

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

// An embedded chat widget on a customer's site, posting with a key of its own.
// Its customers' origins live in a database, so trustedOrigins cannot list them.
describe('a route.ts that answers other sites (export const crossOrigin = true)', () => {
  const chat = (headers: Record<string, string>) =>
    handle()(new Request('https://shop.test/api/v1/chat', { method: 'POST', headers: { host: 'shop.test', ...headers } }))

  test("runs for another site's browser, without the visitor's cookies", async () => {
    seen = null

    const res = await chat({ 'sec-fetch-site': 'cross-site', origin: 'https://skybox.example', cookie: 'session=abc', authorization: 'Bearer key_1' })

    expect(res!.status).toBe(200)
    expect(seen as unknown).toEqual({ cookie: null, read: null, requestCookie: null, authorization: 'Bearer key_1' })
  })

  test('keeps them for its own site', async () => {
    seen = null

    await chat({ 'sec-fetch-site': 'same-origin', cookie: 'session=abc' })

    expect(seen!.read).toBe('abc')
    expect(seen!.requestCookie).toBe('session=abc')
  })

  test('is read from the source: true or false, nothing the build cannot read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cross-origin-'))
    const file = (body: string) => {
      const path = join(dir, `${Math.random().toString(36).slice(2)}.ts`)

      writeFileSync(path, `${body}\nexport function POST() { return new Response('ok') }\n`)

      return path
    }

    expect(crossOriginOf(file('export const crossOrigin = true'))).toEqual({ crossOrigin: true })
    expect(crossOriginOf(file('export const crossOrigin = false'))).toEqual({})
    expect(crossOriginOf(file('// export const crossOrigin = true'))).toEqual({})
    expect(() => crossOriginOf(file('export const crossOrigin = process.env.OPEN'))).toThrow('must be true or false')
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
