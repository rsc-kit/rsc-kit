import { describe, expect, test } from 'bun:test'
import { createTestApp, hostReply, HOST_MIDDLEWARE } from '@rsc-kit/core/testing'

// The Go backend answered in the test: no server running, and RSC_BACKEND
// never called. The app reaches these through the same client it uses
// against Go, so a redirect or a 401 here is the one a visitor would get.
const signedIn = (headers: Headers) => headers.get('cookie')?.includes('session=valid') ?? false

const app = await createTestApp({
  host: {
    'Orders.recent': ({ args }) => [
      { id: 1, total: 1250 },
      { id: 2, total: Number(args[0]) * 100 },
    ],
    'Orders.create': ({ args }) => ({ created: String(args[0]) }),
    // app/admin/middleware.ts names Go's guards; Go answers true or refuses.
    [HOST_MIDDLEWARE]: ({ args, headers }) => {
      expect(args[0]).toEqual(['auth', 'can:manage-orders'])

      return signedIn(headers) ? true : hostReply.unauthenticated()
    },
  },
})

describe('a page whose data lives in Go', () => {
  test('renders what the backend answered', async () => {
    // React separates adjacent text with empty comments.
    const html = (await (await app.fetch('/')).text()).replaceAll('<!-- -->', '')

    expect(html).toContain('#1 — $12.50')
    expect(html).toContain('#2 — $5.00')
  })
})

describe('a page Go guards', () => {
  test('is refused without a session', async () => {
    const response = await app.fetch('/admin')

    expect(response.status).toBe(401)
  })

  test('and rendered with one, the cookie forwarded to the guard', async () => {
    const response = await app.fetch('/admin', { headers: { cookie: 'session=valid' } })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('past the guards Go ran')
  })

  test('a guard that redirects sends the visitor on', async () => {
    const elsewhere = await createTestApp({
      host: { [HOST_MIDDLEWARE]: () => hostReply.redirect('/login') },
    })
    const response = await elsewhere.fetch('/admin', { redirect: 'manual' })

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/login')
  })
})
