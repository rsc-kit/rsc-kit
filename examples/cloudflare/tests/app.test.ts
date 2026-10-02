// The whole app as it is deployed, without a port or a browser.
import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestApp } from '@rsc-kit/core/testing'

let app: Awaited<ReturnType<typeof createTestApp>>

beforeAll(async () => {
  app = await createTestApp()
}, 180_000)

describe('the app', () => {
  test('serves the stored home page', async () => {
    const res = await app.fetch('/')

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('rsc-kit on Cloudflare Workers')
  })

  test('renders the visitor from the request', async () => {
    const res = await app.fetch('/visitor', { headers: { 'cf-ipcountry': 'JM', cookie: 'visits=2' } })
    const html = (await res.text()).replaceAll('<!-- -->', '')

    expect(html).toContain('<strong>JM</strong>')
    expect(html).toContain('<strong>2</strong> visits')
  })

  test('answers the api route as JSON', async () => {
    const body = (await (await app.fetch('/api/time')).json()) as { runtime: string }

    expect(body.runtime).toBe('workerd')
  })

  test('answers a url that matches nothing with a 404', async () => {
    expect((await app.fetch('/no-such-page')).status).toBe(404)
  })
})
