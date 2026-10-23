/**
 * The PPR contract's two endpoints: a platform's edge asks /_ppr/shell for a
 * page's shell and /_ppr/resume for its holes, and nobody without the
 * release's PPR_TOKEN finds either.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { requestSearch, searchParams } from '../../src/request'
import type { RouteManifest } from '../../src/manifest'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('pprContract.test.ts')

const TOKEN = 'a'.repeat(64)
const BUILD = 'b7c1e0f4'

const route = (url: string, component: string, extra: Record<string, unknown> = {}) => ({
  url,
  component,
  segments: url.slice(1).split('/').map((part) =>
    part.startsWith('[') ? { type: 'param', value: part.slice(1, -1) } : { type: 'static', value: part },
  ),
  layouts: ['app/layout'],
  middleware: [],
  loadings: [],
  slots: {},
  sections: [],
  config: null,
  ancestorConfigs: [],
  staticParams: false,
  ...extra,
})

const manifest = () =>
  ({
    version: 'b1',
    routes: [
      route('/pricing', 'app/pricing/page'),
      route('/docs/[slug]', 'app/docs/[slug]/page'),
      route('/admin', 'app/admin/page', { hostMiddleware: ['auth'] }),
      route('/about', 'app/about/page'),
    ],
    intercepts: [],
    apis: [],
  }) as unknown as RouteManifest

const FILES: Record<string, string> = {
  'pricing.ppr.html': '<!DOCTYPE html><html><body>PRICING SHELL',
  'pricing.postponed.json': '{"state":1}',
  'docs/_slug_.ppr.html': '<!DOCTYPE html><html><body>DOCS SHELL',
  'docs/_slug_.postponed.json': '{"state":2}',
  'admin.ppr.html': '<!DOCTYPE html><html><body>ADMIN SHELL',
  'admin.postponed.json': '{"state":3}',
  'about.html': '<!DOCTYPE html><html><body>ABOUT</body></html>',
}

let searched: string | null = null
let param: string | null = null
let holes = '<div>HOLES</div></body></html>'
let body: string | null = null

const handler = (extra: Record<string, unknown> = {}) =>
  createRscHandler({
    engine: {
      manifest,
      installHostFn: () => () => {},
      buildId: async () => BUILD,
      // The host's guard on /admin turns away whoever asks, as signed out.
      async runRouteMiddleware(component: string) {
        if (component !== 'app/admin/page') return

        const error = new Error('no')
        error.name = 'ServerAuthorizationError'
        throw error
      },
      async handleRscResume() {
        searched = requestSearch()
        param = (await searchParams()).get('utm_source')
        return { htmlStream: new Response(holes).body! }
      },
    } as never,
    prerendered: async (name: string) => FILES[name] ?? null,
    ...extra,
  } as never)

const shell = (path: string, headers: Record<string, string> = { 'PPR-Token': TOKEN }) =>
  handler()(new Request(`https://x.test/_ppr/shell?path=${encodeURIComponent(path)}`, { headers }))

const resume = async (url: string, headers: Record<string, string> = { 'PPR-Token': TOKEN }) => {
  const response = await handler()(
    new Request(`https://x.test/_ppr/resume?url=${encodeURIComponent(url)}`, { method: 'POST', headers, body: 'ignored' }),
  )
  body = response?.body ? await response.text() : null
  return response
}

afterEach(() => {
  delete process.env.PPR_TOKEN
  searched = null
})

describe('switched on by PPR_TOKEN', () => {
  test('unset, both endpoints are a 404 even to a caller sending a token', async () => {
    expect((await shell('/pricing'))?.status).toBe(404)
    expect((await resume('/pricing'))?.status).toBe(404)
  })

  test('a missing or wrong token is a 404 too', async () => {
    process.env.PPR_TOKEN = TOKEN

    expect((await shell('/pricing', {}))?.status).toBe(404)
    expect((await shell('/pricing', { 'PPR-Token': 'b'.repeat(64) }))?.status).toBe(404)
    expect((await resume('/pricing', {}))?.status).toBe(404)
  })

  test('no answer under /_ppr/ may be stored on the way, a 404 included', async () => {
    expect((await shell('/pricing'))?.headers.get('Cache-Control')).toBe('private, no-store')

    process.env.PPR_TOKEN = TOKEN

    expect((await shell('/pricing'))?.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await shell('/about'))?.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await resume('/pricing'))?.headers.get('Cache-Control')).toBe('private, no-store')
  })

  test('the whole prefix is reserved: nothing under /_ppr/ is the app\'s', async () => {
    process.env.PPR_TOKEN = TOKEN

    const response = await handler()(new Request('https://x.test/_ppr/other', { headers: { 'PPR-Token': TOKEN } }))

    expect(response?.status).toBe(404)
  })
})

describe('the shell', () => {
  test('is JSON with the build, the html and an empty state, and says its build', async () => {
    process.env.PPR_TOKEN = TOKEN

    const response = await shell('/pricing')

    expect(response?.status).toBe(200)
    expect(response?.headers.get('PPR-Build')).toBe(BUILD)
    expect(response?.headers.get('Content-Type')).toBe('application/json')
    expect(await response!.json()).toEqual({
      v: 1,
      build: BUILD,
      html: '<!DOCTYPE html><html><body>PRICING SHELL',
      state: '',
    })
  })

  test('a pattern\'s shell answers a path it matches', async () => {
    process.env.PPR_TOKEN = TOKEN

    expect(((await (await shell('/docs/intro'))!.json()) as { html: string }).html).toContain('DOCS SHELL')
  })

  test('a guarded page, a page that is not PPR and an unknown path are each a 404', async () => {
    process.env.PPR_TOKEN = TOKEN

    for (const path of ['/admin', '/about', '/nowhere']) expect((await shell(path))?.status).toBe(404)
  })

  test('a path that would not survive the trip unchanged is a 404', async () => {
    process.env.PPR_TOKEN = TOKEN

    for (const path of ['/docs/../pricing', '/pricing?x=1', 'pricing', '/docs/a%2Fb']) {
      expect((await shell(path))?.status).toBe(404)
    }
  })
})

describe('the resume', () => {
  test('is only the holes, with the build, rendered for the visitor\'s url and query', async () => {
    process.env.PPR_TOKEN = TOKEN

    const response = await resume('/pricing?utm_source=news')

    expect(response?.status).toBe(200)
    expect(response?.headers.get('PPR-Build')).toBe(BUILD)
    expect(response?.headers.get('Content-Type')).toContain('text/html')
    expect(body).toBe('<div>HOLES</div></body></html>')
    expect(body).not.toContain('<html')
    expect(searched).toBe('?utm_source=news')
    expect(param).toBe('news')
  })

  test('a guarded page runs its guard first, as the document would', async () => {
    process.env.PPR_TOKEN = TOKEN

    const response = await resume('/admin')

    expect(response?.status).toBe(403)
    expect(body).not.toContain('HOLES')
  })
})

test('the resume is never compressed, whatever the request accepts', async () => {
  process.env.PPR_TOKEN = TOKEN
  // Large enough that anything else this size would be.
  holes = `<div>${'HOLES '.repeat(4000)}</div></body></html>`

  const response = await handler({ compress: true })(
    new Request(`https://x.test/_ppr/resume?url=${encodeURIComponent('/pricing')}`, {
      method: 'POST',
      headers: { 'PPR-Token': TOKEN, 'Accept-Encoding': 'gzip, br' },
    }),
  )

  expect(response?.headers.get('Content-Encoding')).toBeNull()
  expect(await response!.text()).toBe(holes)
})
