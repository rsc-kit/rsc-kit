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

  test('ships no JavaScript - not in the page, and not in its headers either', async () => {
    // The headers are the half that got away. The page carries no script
    // tag, and the build's own check has always said so; the Link header
    // hinted the client entry as a modulepreload anyway, so every visitor
    // downloaded 82 KB of runtime the page never runs and Lighthouse put
    // it on the critical path. Both halves, here, through the handler
    // that answers in production.
    const res = await app.fetch('/')
    const html = await res.text()

    expect(html).not.toContain('<script')
    expect(res.headers.get('Link') ?? '').not.toContain('modulepreload')
    expect(res.headers.get('Link') ?? '').not.toContain('.js')
  })
})
