// GET /_rsc/health: whether this renderer can serve. A platform routes to it
// on this answer, so it says 503 - with why - when the backend does not
// answer, rather than leaving the open port to suggest it is ready.

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import type { RouteManifest } from '../../src/manifest'

const manifest = { version: 1, routes: [], intercepts: [], apis: [] } as unknown as RouteManifest

const handle = (checkBackend?: () => Promise<string | null>) =>
  createRscHandler({
    engine: { manifest: () => manifest, installHostFn: () => () => {}, ...(checkBackend ? { checkBackend } : {}) } as never,
    manifest,
    version: 'build-7',
  })

const health = async (h: ReturnType<typeof handle>, init?: RequestInit) => {
  const res = await h(new Request('https://app.test/_rsc/health', init))

  return { status: res!.status, body: init?.method === 'HEAD' ? null : await res!.json(), cache: res!.headers.get('cache-control') }
}

describe('the health path', () => {
  test('an app with no backend is ready when it is up', async () => {
    expect(await health(handle(async () => null))).toEqual({
      status: 200,
      body: { ok: true, version: 'build-7', backend: 'none' },
      cache: 'no-store',
    })
  })

  test('with a backend that answers, ready', async () => {
    expect((await health(handle(async () => 'ok'))).body).toEqual({ ok: true, version: 'build-7', backend: 'ok' })
  })

  test('with a backend that does not - down, or refusing the secret - 503 and why', async () => {
    const { status, body } = await health(handle(async () => 'bad or missing host secret'))

    expect(status).toBe(503)
    expect(body).toEqual({ ok: false, version: 'build-7', backend: 'bad or missing host secret' })
  })

  test('HEAD answers the status alone; anything else is refused', async () => {
    expect((await health(handle(async () => 'down'), { method: 'HEAD' })).status).toBe(503)
    expect((await handle(async () => 'ok')(new Request('https://app.test/_rsc/health', { method: 'POST' })))!.status).toBe(405)
  })
})
