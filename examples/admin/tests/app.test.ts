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
    expect(await res.text()).toContain('Open the panel')
  })

  test('serves the panel, a table in each mode, a form, and a 404 for a resource it does not have', async () => {
    expect((await app.fetch('/admin')).status).toBe(200)
    expect(await (await app.fetch('/admin/products?status=active')).text()).toContain('SKU')
    expect((await app.fetch('/admin/categories')).status).toBe(200)
    expect((await app.fetch('/admin/products/new')).status).toBe(200)
    expect((await app.fetch('/admin/products/1')).status).toBe(200)
    expect((await app.fetch('/admin/nope')).status).toBe(404)
    expect((await app.fetch('/admin/products/999')).status).toBe(404)
  })

  test('answers a url that matches nothing with a 404', async () => {
    expect((await app.fetch('/no-such-page')).status).toBe(404)
  })
})
