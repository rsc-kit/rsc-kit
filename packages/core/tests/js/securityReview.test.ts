/**
 * Holes found by a security review of the host, each pinned by the request
 * that got through.
 *
 * Every one had the same shape as the ones protocolAbuse.test.ts pins: a
 * check asked one question and the answer was served from somewhere the check
 * did not look - a file found by name, a guard in the host's vocabulary, a
 * cache keyed on the wrong thing, a body read before any limit.
 */

import { describe, expect, test } from 'bun:test'
import { createRscHandler, queryAndParams } from '../../src/host'
import { pathKey } from '../../src/prerender'
import { withHead } from '../../src/shellHead'
import type { RouteManifest } from '../../src/manifest'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('securityReview.test.ts')

const route = (url: string, component: string, extra: Record<string, unknown> = {}) => ({
  url,
  component,
  segments: url === '/' ? [] : url.slice(1).split('/').map((part) =>
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

function manifest(): RouteManifest {
  return {
    version: 'b1',
    routes: [
      // The root carries a guard of the engine's; /admin one of the host's,
      // the way a Laravel app writes it; /p/[slug] none at all.
      route('/', 'app/page', { middleware: ['app/middleware'] }),
      route('/admin', 'app/admin/page', { hostMiddleware: ['auth'] }),
      route('/p/[slug]', 'app/p/[slug]/page'),
      route('/[slug]', 'app/[slug]/page'),
    ],
    intercepts: [],
    apis: [
      {
        name: 'app/admin/export/route',
        segments: [{ type: 'static', value: 'admin' }, { type: 'static', value: 'export' }],
        methods: ['GET'],
        middleware: [],
        hostMiddleware: ['auth'],
      },
    ],
  } as unknown as RouteManifest
}

/** An engine whose guards let through only a request that says it is signed in. */
function engine() {
  const asked: string[] = []

  return {
    asked,
    manifest,
    installHostFn: () => () => {},
    async runRouteMiddleware(component: string) {
      asked.push(component)

      if (!signedIn) {
        const error = new Error('no')
        error.name = 'ServerAuthorizationError'
        throw error
      }
    },
    async handleRscHtmlStream() {
      return { htmlStream: new Response('<html><body>RENDERED</body></html>').body! }
    },
    async handleRscStream(...args: unknown[]) {
      return { stream: new Response('RENDERED PAYLOAD').body!, segmentDepth: args[6] as number }
    },
    async handleApiRoute() {
      return new Response('THE EXPORT')
    },
    async handleRscFormPost() {
      return { htmlStream: new Response('POSTED').body! }
    },
  }
}

let signedIn = false

const FILES: Record<string, string> = {
  'index.html': '<html><body>ROOT PAGE</body></html>',
  'index.flight': 'ROOT PAYLOAD',
  'index.meta.json': '{"layouts":["app/layout"]}',
  'admin.html': '<html><body>ADMIN PAGE</body></html>',
  'admin.ppr.html': '<html><body>ADMIN SHELL</body></html>',
  'admin.flight': 'ADMIN PAYLOAD',
  'admin.meta.json': '{"layouts":["app/layout"]}',
}

const handler = (extra: Record<string, unknown> = {}) =>
  createRscHandler({
    engine: engine() as never,
    prerendered: async (name: string) => FILES[name] ?? null,
    ...extra,
  } as never)

const text = async (response: Response | null) => (response?.body ? await response.text() : '')

describe('a stored file is read only by the url it was stored for', () => {
  test('a url naming a guarded page\'s shell is not handed it', async () => {
    signedIn = false

    const response = await handler()(new Request('https://x.test/admin.ppr'))

    expect(await text(response)).not.toContain('ADMIN SHELL')
  })

  test('a url spelling the root\'s file name does not skip the root\'s guard', async () => {
    signedIn = false

    for (const headers of [{}, { 'X-RSC': 'true' }]) {
      const response = await handler()(new Request('https://x.test/index', { headers }))
      const body = await text(response)

      expect(body).not.toContain('ROOT PAGE')
      expect(body).not.toContain('ROOT PAYLOAD')
    }
  })
})

describe('a guard written in the host\'s vocabulary', () => {
  test('keeps the edge shell endpoint from handing out the shell', async () => {
    signedIn = false

    const response = await handler()(new Request('https://x.test/_rsc/ppr-shell?url=/admin'))

    expect(response?.status).toBe(404)
    expect(await text(response)).not.toContain('ADMIN SHELL')
  })

  test('guards a route.ts beside the pages it covers', async () => {
    signedIn = false

    const response = await handler()(new Request('https://x.test/admin/export'))

    expect(response?.status).toBe(403)
    expect(await text(response)).not.toContain('THE EXPORT')
  })

  test('and a guarded page, once allowed, is never marked for a shared cache', async () => {
    signedIn = true

    const page = await handler()(new Request('https://x.test/admin'))
    const payload = await handler()(new Request('https://x.test/admin', { headers: { 'X-RSC': 'true' } }))

    expect(await text(page)).toContain('ADMIN PAGE')
    expect(page?.headers.get('Cache-Control')).toBe('private, no-store')
    expect(payload?.headers.get('Cache-Control')).toBe('private, no-store')
    signedIn = false
  })
})

describe('a page rendered for one request', () => {
  test('is not marked public', async () => {
    const response = await handler()(new Request('https://x.test/p/anything'))

    expect(await text(response)).toContain('RENDERED')
    expect(response?.headers.get('Cache-Control')).not.toContain('public')
  })
})

describe('a form posted without a runtime', () => {
  test('is held to the same ceiling as an action', async () => {
    const response = await handler({ maxActionBody: 1024 })(
      new Request('https://x.test/p/anything', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://x.test' },
        body: 'a=' + 'x'.repeat(10_000),
      }),
    )

    expect(response?.status).toBe(413)
  })
})

describe('a page\'s props', () => {
  test('take a route param over a query of the same name', () => {
    // [domain] binds only from the host; ?domain= was whoever wrote the link.
    const props = queryAndParams(
      { route: {}, params: { domain: 'acme' } } as never,
      new Request('https://acme.example.test/settings?domain=evil&tab=billing'),
    )

    expect(props).toEqual({ domain: 'acme', tab: 'billing' })
  })
})

describe('small things', () => {
  test('a run of slashes costs a linear trim', () => {
    const path = '/a' + '/'.repeat(40_000) + 'a'
    const started = performance.now()

    expect(pathKey(path)).toBe(path.slice(1))
    expect(performance.now() - started).toBeLessThan(50)
  })

  test('a title holding $\' or $` is written as text, not as the rest of the document', () => {
    const shell = '<html><head><title>x</title></head><body>SECRET BODY</body></html>'
    const out = withHead(shell, { title: "Price $' and $`" } as never)

    expect(out).toContain("<title>Price $' and $`</title>")
    expect(out.match(/SECRET BODY/g)?.length).toBe(1)
  })
})
