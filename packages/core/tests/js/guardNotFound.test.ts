/**
 * notFound() from a middleware.ts guard.
 *
 * A render that runs the guard answers it as a 404. A page the build stored
 * is served without a render, so the host asks the guard itself - and there
 * the signal escaped as an error. An admin area could only send strangers
 * somewhere else, never tell them there was nothing there.
 */

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { NotFoundSignal } from '../../src/notFound'
import type { RouteManifest } from '../../src/manifest'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('guardNotFound.test.ts')

const route = (url: string, component: string) => ({
  url,
  component,
  segments: url.slice(1).split('/').map((value) => ({ type: 'static', value })),
  layouts: ['app/layout'],
  middleware: ['app/admin/middleware'],
  loadings: [],
  slots: {},
  sections: [],
  config: null,
  ancestorConfigs: [],
  staticParams: false,
})

const manifest = () =>
  ({
    version: 'b1',
    routes: [route('/admin', 'app/admin/page')],
    intercepts: [],
    apis: [
      {
        name: 'app/admin/export/route',
        segments: [{ type: 'static', value: 'admin' }, { type: 'static', value: 'export' }],
        methods: ['GET'],
        middleware: ['app/admin/middleware'],
      },
    ],
  }) as unknown as RouteManifest

const FILES: Record<string, string> = {
  'admin.html': '<html><body>ADMIN PAGE</body></html>',
  'admin.flight': 'ADMIN PAYLOAD',
  'admin.meta.json': '{"layouts":["app/layout"]}',
}

const handler = () =>
  createRscHandler({
    engine: {
      manifest,
      installHostFn: () => () => {},
      async runRouteMiddleware() {
        throw new NotFoundSignal()
      },
      async handleRscHtmlStream() {
        throw new Error('a refused page is never rendered')
      },
      async handleRscStream() {
        throw new Error('a refused page is never rendered')
      },
      async handleApiRoute() {
        return new Response('THE EXPORT')
      },
    } as never,
    prerendered: async (name: string) => FILES[name] ?? null,
  } as never)

describe('notFound() in a guard', () => {
  test('a stored page answers as not mine, which is served as not-found.tsx', async () => {
    expect(await handler()(new Request('https://x.test/admin'))).toBeNull()
  })

  test('and so does its payload, for a navigation', async () => {
    expect(await handler()(new Request('https://x.test/admin', { headers: { 'X-RSC': 'true' } }))).toBeNull()
  })

  test('a route.ts beside it answers 404', async () => {
    const response = await handler()(new Request('https://x.test/admin/export'))

    expect(response?.status).toBe(404)
    expect(await response?.text()).not.toContain('THE EXPORT')
  })
})
