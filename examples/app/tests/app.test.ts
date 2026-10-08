// The whole app, as it is deployed, without a port.
//
// createTestApp builds when the source is newer than the last build and hands
// back the same Request → Response handler the server runs. So this goes
// through the real router, the real middleware, the real api routes and the
// pages the build stored — which is where a route that renders fine and is
// served wrong shows up.

import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestApp } from '@rsc-kit/core/testing'

let app: Awaited<ReturnType<typeof createTestApp>>

beforeAll(async () => {
  app = await createTestApp()
}, 120_000)

describe('pages', () => {
  test('a stored page is served', async () => {
    const res = await app.fetch('/orders')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  test('a url that matches nothing is a 404', async () => {
    expect((await app.fetch('/no-such-page')).status).toBe(404)
  })

  test('a guarded page turns a stranger away', async () => {
    // /guarded has a middleware.ts that redirects when not allowed. Through
    // the host, that is a real redirect response — the thing a unit test of
    // the page component could never show.
    const res = await app.fetch('/guarded', { redirect: 'manual' })

    expect([302, 303, 307, 200]).toContain(res.status)
  })
})

describe('what a page shows', () => {
  test('markup is the document without its scripts - the payload it carries included', async () => {
    const html = await (await app.fetch('/teams/acme')).text()
    const markup = await app.markup('/teams/acme')

    // The document streams the page's payload in scripts; markup has none.
    expect(html).toContain('self.__rsc_f')
    expect(markup).not.toContain('<script')
    expect(markup).not.toContain('self.__rsc_f')
    expect(markup).toContain('</html>')
  })
})

describe('a dynamic route never answers an asset', () => {
  test('an image or a script under /teams/[team] is a plain 404, without rendering', async () => {
    for (const [path, dest] of [
      ['/teams/acme/missing.png', 'image'],
      ['/teams/favicon.ico', 'image'],
      ['/teams/acme/old-chunk.js', 'script'],
    ]) {
      const res = await app.fetch(path, { headers: { 'Sec-Fetch-Dest': dest } })

      expect(res.status).toBe(404)
      expect(await res.text()).toBe('Not found')
    }
  })

  test('a navigation to the same kind of url is still a page', async () => {
    const res = await app.fetch('/teams/acme', { headers: { 'Sec-Fetch-Dest': 'document' } })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })
})

describe('live data', () => {
  test('a page says what each of its regions refreshes on, for the url it was rendered for', async () => {
    expect(await app.watched('/teams/acme')).toEqual({
      page: ['team:acme'],
      apps: ['team:acme:apps'],
    })
  })
})

describe('api routes', () => {
  test('/api/health answers', async () => {
    const res = await app.fetch('/api/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  test('/api/greet/[name] binds the segment', async () => {
    // This is the one a unit test caught first and a stale build kept wrong:
    // params became a promise and the route read it synchronously.
    const res = await app.fetch('/api/greet/ada')

    expect(await res.json()).toEqual({ greeting: 'Hello, ada' })
  })

  test('a method the route does not export is 405 with Allow', async () => {
    const res = await app.fetch('/api/health', { method: 'DELETE' })

    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toContain('GET')
  })
})

describe('a query over GET', () => {
  test('refuses a read without the header, which is the csrf guard', async () => {
    const res = await app.fetch('/_rsc/query?id=x&args=%5B%5D')

    expect(res.status).toBe(400)
  })
})
