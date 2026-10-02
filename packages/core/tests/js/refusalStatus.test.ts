/**
 * A status the host chose reaches the visitor.
 *
 * A host refusing a call names a status - Go's Refuse(503), Laravel's
 * abort(503) or its maintenance mode - and the page answers with it. A 503
 * collapsed to a 500 tells a client and a load balancer the app is broken
 * rather than to come back. A crash carries no status and stays a failure.
 */

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import type { RouteManifest } from '../../src/manifest'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('refusalStatus.test.ts')

const manifest = () =>
  ({
    version: 'b1',
    routes: [
      {
        url: '/status',
        component: 'app/status/page',
        segments: [{ type: 'static', value: 'status' }],
        layouts: ['app/layout'],
        middleware: [],
        loadings: [],
        slots: {},
        sections: [],
        config: null,
        ancestorConfigs: [],
        staticParams: false,
      },
    ],
    intercepts: [],
    apis: [],
  }) as unknown as RouteManifest

/** An engine whose render fails with `error`, as a page whose host call was refused. */
function handler(error: unknown) {
  const fail = async () => {
    throw error
  }

  return createRscHandler({
    engine: {
      manifest,
      installHostFn: () => () => {},
      runRouteMiddleware: async () => {},
      handleRscHtmlStream: fail,
      handleRscStream: fail,
    },
    prerendered: async () => null,
  } as never)
}

const refused = (status: number, message: string) =>
  Object.assign(new Error(`Host call "Status.read" failed: ${message}`), { refusalStatus: status })

describe('a refusal with a status', () => {
  for (const status of [429, 503, 500]) {
    test(`answers ${status}, with the host's message, for the document and the payload`, async () => {
      for (const headers of [{}, { 'X-RSC': 'true' }] as Record<string, string>[]) {
        const response = await handler(refused(status, 'Down for maintenance.'))(
          new Request('https://x.test/status', { headers }),
        )

        expect(response?.status).toBe(status)
        expect(await response?.text()).toContain('Down for maintenance.')
      }
    })
  }

  test('a status that is not an error is not honoured', async () => {
    for (const status of [200, 302]) {
      const request = new Request('https://x.test/status')

      await expect(handler(refused(status, 'x'))(request)).rejects.toThrow('x')
    }
  })

  test('a crash, which carries none, stays a failure', async () => {
    await expect(handler(new Error('boom'))(new Request('https://x.test/status'))).rejects.toThrow('boom')
  })
})
