/**
 * The edge contract's two endpoints: a platform's edge asks /_edge/page for a
 * page, whole or as a shell, and /_edge/resume for its holes, and nobody without the
 * EDGE_TOKEN the platform set finds either.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { requestSearch, searchParams } from '../../src/request'
import type { RouteManifest } from '../../src/manifest'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('pprContract.test.ts')

const TOKEN = 'a'.repeat(64)
const BUILD = 'shells-b7c1e0f4'

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
  // What the build writes beside the pages: not the client's id.
  '_edge.json': JSON.stringify({ v: 2, build: 'shells-b7c1e0f4', shells: ['/pricing', '/docs/[slug]'], static: ['/about'] }),
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
      buildId: async () => 'client-id',
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

const shell = (path: string, headers: Record<string, string> = { 'Edge-Token': TOKEN }) =>
  handler()(new Request(`https://x.test/_edge/page?path=${encodeURIComponent(path)}`, { headers }))

const resume = async (url: string, headers: Record<string, string> = { 'Edge-Token': TOKEN }) => {
  const response = await handler()(
    new Request(`https://x.test/_edge/resume?url=${encodeURIComponent(url)}`, { method: 'POST', headers, body: 'ignored' }),
  )
  body = response?.body ? await response.text() : null
  return response
}

afterEach(() => {
  delete process.env.EDGE_TOKEN
  searched = null
})

describe('switched on by EDGE_TOKEN', () => {
  test('unset, both endpoints are a 404 even to a caller sending a token', async () => {
    expect((await shell('/pricing'))?.status).toBe(404)
    expect((await resume('/pricing'))?.status).toBe(404)
  })

  test('a missing or wrong token is a 404 too', async () => {
    process.env.EDGE_TOKEN = TOKEN

    expect((await shell('/pricing', {}))?.status).toBe(404)
    expect((await shell('/pricing', { 'Edge-Token': 'b'.repeat(64) }))?.status).toBe(404)
    expect((await resume('/pricing', {}))?.status).toBe(404)
  })

  test('no answer under /_edge/ may be stored on the way, a 404 included', async () => {
    expect((await shell('/pricing'))?.headers.get('Cache-Control')).toBe('private, no-store')

    process.env.EDGE_TOKEN = TOKEN

    expect((await shell('/pricing'))?.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await shell('/about'))?.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await resume('/pricing'))?.headers.get('Cache-Control')).toBe('private, no-store')
  })

  test('the whole prefix is reserved: nothing under /_edge/ is the app\'s', async () => {
    process.env.EDGE_TOKEN = TOKEN

    const response = await handler()(new Request('https://x.test/_edge/other', { headers: { 'Edge-Token': TOKEN } }))

    expect(response?.status).toBe(404)
  })
})

describe('the shell', () => {
  test('is JSON with the build, the html and an empty state, and says its build', async () => {
    process.env.EDGE_TOKEN = TOKEN

    const response = await shell('/pricing')

    expect(response?.status).toBe(200)
    expect(response?.headers.get('Edge-Build')).toBe(BUILD)
    expect(response?.headers.get('Content-Type')).toBe('application/json')
    expect(await response!.json()).toEqual({
      v: 2,
      build: BUILD,
      html: '<!DOCTYPE html><html><body>PRICING SHELL',
      state: '',
    })
  })

  test('a pattern\'s shell answers a path it matches', async () => {
    process.env.EDGE_TOKEN = TOKEN

    expect(((await (await shell('/docs/intro'))!.json()) as { html: string }).html).toContain('DOCS SHELL')
  })

  test('a guarded page and an unknown path are each a 404', async () => {
    process.env.EDGE_TOKEN = TOKEN

    for (const path of ['/admin', '/nowhere']) expect((await shell(path))?.status).toBe(404)
  })

  test('a path that would not survive the trip unchanged is a 404', async () => {
    process.env.EDGE_TOKEN = TOKEN

    for (const path of ['/docs/../pricing', '/pricing?x=1', 'pricing', '/docs/a%2Fb']) {
      expect((await shell(path))?.status).toBe(404)
    }
  })
})

describe('the resume', () => {
  test('is only the holes, with the build, rendered for the visitor\'s url and query', async () => {
    process.env.EDGE_TOKEN = TOKEN

    const response = await resume('/pricing?utm_source=news')

    expect(response?.status).toBe(200)
    expect(response?.headers.get('Edge-Build')).toBe(BUILD)
    expect(response?.headers.get('Content-Type')).toContain('text/html')
    expect(body).toBe('<div>HOLES</div></body></html>')
    expect(body).not.toContain('<html')
    expect(searched).toBe('?utm_source=news')
    expect(param).toBe('news')
  })

  test('a guarded page runs its guard first, as the document would', async () => {
    process.env.EDGE_TOKEN = TOKEN

    const response = await resume('/admin')

    expect(response?.status).toBe(403)
    expect(body).not.toContain('HOLES')
  })
})

test('the resume is never compressed, whatever the request accepts', async () => {
  process.env.EDGE_TOKEN = TOKEN
  // Large enough that anything else this size would be.
  holes = `<div>${'HOLES '.repeat(4000)}</div></body></html>`

  const response = await handler({ compress: true })(
    new Request(`https://x.test/_edge/resume?url=${encodeURIComponent('/pricing')}`, {
      method: 'POST',
      headers: { 'Edge-Token': TOKEN, 'Accept-Encoding': 'gzip, br' },
    }),
  )

  expect(response?.headers.get('Content-Encoding')).toBeNull()
  expect(await response!.text()).toBe(holes)
})

test('without the build the marker names, the endpoints are not there', async () => {
  process.env.EDGE_TOKEN = TOKEN

  const response = await createRscHandler({
    engine: { manifest, installHostFn: () => () => {}, buildId: async () => 'client-id' } as never,
    prerendered: async (name: string) => (name === '_edge.json' ? null : (FILES[name] ?? null)),
  } as never)(new Request('https://x.test/_edge/page?path=/pricing', { headers: { 'Edge-Token': TOKEN } }))

  expect(response?.status).toBe(404)
})

describe('a static page', () => {
  test('goes whole, complete, with the build', async () => {
    process.env.EDGE_TOKEN = TOKEN

    const response = await shell('/about')

    expect(response?.status).toBe(200)
    expect(response?.headers.get('Edge-Build')).toBe(BUILD)
    expect(response?.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response!.json()).toEqual({
      v: 2,
      build: BUILD,
      html: '<!DOCTYPE html><html><body>ABOUT</body></html>',
      state: '',
      complete: true,
    })
  })

  test('a shell is never complete', async () => {
    process.env.EDGE_TOKEN = TOKEN

    expect(((await (await shell('/pricing'))!.json()) as { complete?: boolean }).complete).toBeUndefined()
  })

  test('only a path the marker lists goes whole: a stored page it leaves out is a 404', async () => {
    process.env.EDGE_TOKEN = TOKEN
    FILES['contact.html'] = '<!DOCTYPE html><html><body>CONTACT</body></html>'

    try {
      expect((await shell('/contact'))?.status).toBe(404)
    } finally {
      delete FILES['contact.html']
    }
  })

  test('a guarded page is a 404 even if the marker named it', async () => {
    process.env.EDGE_TOKEN = TOKEN
    const marker = FILES['_edge.json']
    FILES['_edge.json'] = JSON.stringify({ v: 2, build: BUILD, shells: [], static: ['/admin'] })
    FILES['admin.html'] = '<!DOCTYPE html><html><body>ADMIN PAGE</body></html>'

    try {
      const response = await handler()(new Request('https://x.test/_edge/page?path=/admin', { headers: { 'Edge-Token': TOKEN } }))

      expect(response?.status).toBe(404)
      expect(await response!.text()).not.toContain('ADMIN PAGE')
    } finally {
      FILES['_edge.json'] = marker
      delete FILES['admin.html']
    }
  })
})
