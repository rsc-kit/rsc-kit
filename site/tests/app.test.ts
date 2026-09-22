// The whole app as it is deployed, without a port or a browser.
//
// createTestApp builds when the source is newer than the last build and hands
// back the same Request → Response handler the server runs: the real router,
// the real middleware, the real api routes, the pages the build stored.
import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestApp } from '@rsc-kit/core/testing'

let app: Awaited<ReturnType<typeof createTestApp>>

beforeAll(async () => {
  app = await createTestApp()
}, 120_000)

describe('the app', () => {
  test('serves the home page', async () => {
    const res = await app.fetch('/')

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('site')
  })

  test('answers a url that matches nothing with a 404', async () => {
    expect((await app.fetch('/no-such-page')).status).toBe(404)
  })
})
