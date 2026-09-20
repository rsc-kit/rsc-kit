// A redirect() from a route.ts, and from the guard above one.
//
// A handler that throws redirect() is answering, not failing: the export
// lives on a signed url now, the old endpoint moved. That is a real Location
// for whoever asked. A guard's redirect is different - it is a refusal, and
// what it should look like depends on who is refused: a browser that
// navigated to the route is sent on, code that fetched it is told where and
// left to decide, because fetch would follow a Location on its own and hand
// back the login page as the endpoint's answer.

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { redirect } from '../../src/redirect'
import { notFound } from '../../src/notFound'
import type { RouteManifest } from '../../src/manifest'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('apiRouteRedirect.test.ts')

const manifest = {
  version: 'b1',
  routes: [],
  intercepts: [],
  apis: [
    { name: 'app/api/export/route', segments: [{ type: 'static', value: 'api' }, { type: 'static', value: 'export' }], methods: ['GET'], middleware: [] },
    { name: 'app/api/gone/route', segments: [{ type: 'static', value: 'api' }, { type: 'static', value: 'gone' }], methods: ['GET'], middleware: [] },
    { name: 'app/api/broken/route', segments: [{ type: 'static', value: 'api' }, { type: 'static', value: 'broken' }], methods: ['GET'], middleware: [] },
    { name: 'app/agent-account/route', segments: [{ type: 'static', value: 'agent-account' }], methods: ['GET'], middleware: ['app/agent-account/middleware'] },
  ],
} as unknown as RouteManifest

const engine = {
  manifest: () => manifest,
  installHostFn: () => () => {},
  async runRouteMiddleware() {
    redirect('/login')
  },
  async handleApiRoute(name: string) {
    if (name === 'app/api/export/route') redirect('https://files.example/export.csv?sig=abc')
    if (name === 'app/api/gone/route') notFound()
    if (name === 'app/api/broken/route') throw new Error('the handler itself failed')

    return new Response('ok')
  },
}

const handle = () => createRscHandler({ engine: engine as never })

describe('a redirect() thrown from the handler', () => {
  test('is the answer: a real Location, whoever asked', async () => {
    const res = await handle()(new Request('https://x.test/api/export'))

    expect(res!.status).toBe(307)
    expect(res!.headers.get('Location')).toBe('https://files.example/export.csv?sig=abc')
  })

  test('and notFound() is its 404', async () => {
    const res = await handle()(new Request('https://x.test/api/gone'))

    expect(res!.status).toBe(404)
  })

  test('while a handler that really failed still fails', async () => {
    await expect(handle()(new Request('https://x.test/api/broken'))).rejects.toThrow('the handler itself failed')
  })
})

describe("a guard's redirect on a route.ts", () => {
  test('sends a browser that navigated there on, with a Location', async () => {
    const res = await handle()(
      new Request('https://x.test/agent-account', {
        headers: { 'sec-fetch-mode': 'navigate', accept: 'text/html,*/*' },
      }),
    )

    expect(res!.status).toBe(307)
    expect(res!.headers.get('Location')).toBe('/login')
  })

  test('tells code that fetched it, and does not follow', async () => {
    const res = await handle()(
      new Request('https://x.test/agent-account', { headers: { 'sec-fetch-mode': 'cors', accept: 'application/json' } }),
    )

    expect(res!.status).toBe(401)
    expect(res!.headers.get('X-RSC-Redirect')).toBe('/login')
    expect(res!.headers.get('Location')).toBeNull()
  })

  test('a request with no fetch metadata is read by what it accepts', async () => {
    const browser = await handle()(new Request('https://x.test/agent-account', { headers: { accept: 'text/html' } }))
    const code = await handle()(new Request('https://x.test/agent-account'))

    expect(browser!.status).toBe(307)
    expect(code!.status).toBe(401)
  })
})
