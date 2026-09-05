/**
 * Reading the request from inside a render.
 *
 * The interesting cases are the two boundaries: a build has no request, and
 * two requests must not see each other's headers.
 */

import { describe, expect, test } from 'bun:test'
import { cookies, headers, request, requestWasRead, url, withRequest } from '../../src/request'

const req = (init: RequestInit = {}) => new Request('https://x.test/admin', init)

/**
 * A request carrying cookies, expressed the way a host forwards one.
 *
 * Not `new Request(url, { headers: { cookie } })`: Cookie is a forbidden
 * header name for a Headers built with the request guard, so a spec-compliant
 * environment drops it on construction. A real incoming request has it — it
 * was never constructed in JavaScript — but a test cannot make one.
 */
const withCookies = (cookie: string) => ({ url: 'https://x.test/admin', headers: { cookie } })

describe('during a request', () => {
  test('headers are the ones that arrived', async () => {
    await withRequest(req({ headers: { 'accept-language': 'fr-CA,fr;q=0.9' } }), async () => {
      expect((await headers()).get('accept-language')).toBe('fr-CA,fr;q=0.9')
    })
  })

  test('cookies are parsed from the header', async () => {
    await withRequest(withCookies('locale=fr; theme=dark'), async () => {
      expect((await cookies()).get('locale')).toBe('fr')
      expect((await cookies()).has('theme')).toBe(true)
      expect((await cookies()).has('nothing')).toBe(false)
      expect((await cookies()).getAll()).toEqual({ locale: 'fr', theme: 'dark' })
    })
  })

  test('a cookie value is decoded the way it was written', async () => {
    await withRequest(withCookies('next=%2Fadmin%3Fa%3D1'), async () => {
      expect((await cookies()).get('next')).toBe('/admin?a=1')
    })
  })

  test('a malformed escape is left as it arrived rather than thrown away', async () => {
    // One bad cookie must not take the render with it.
    await withRequest(withCookies('a=%E0%A4%A; b=fine'), async () => {
      expect((await cookies()).get('a')).toBe('%E0%A4%A')
      expect((await cookies()).get('b')).toBe('fine')
    })
  })

  test('the whole request is there for anything else', async () => {
    await withRequest(req(), async () => {
      expect(new URL((await request())!.url).pathname).toBe('/admin')
    })
  })
})

describe('between requests', () => {
  test('two in flight cannot see each other', async () => {
    const seen: string[] = []

    const one = (locale: string, delay: number) =>
      withRequest(withCookies(`locale=${locale}`), async () => {
        await new Promise((r) => setTimeout(r, delay))
        seen.push((await cookies()).get('locale')!)
      })

    await Promise.all([one('fr', 20), one('en', 1)])

    expect(seen.sort()).toEqual(['en', 'fr'])
  })
})

describe('during a build', () => {
  test('a read suspends instead of answering', async () => {
    // The whole reason these are async. There is no request at build time, so
    // the read never settles — React suspends the component, its fallback goes
    // into the frozen shell, and only that boundary ends up dynamic. Answering
    // with empty headers would bake one visitor's answer into a page served to
    // everyone; answering synchronously could only mark the whole route
    // dynamic, because there would be nothing to suspend on.
    const settled = await withRequest(null, () =>
      Promise.race([
        headers().then(() => 'settled'),
        new Promise((r) => setTimeout(() => r('still waiting'), 50)),
      ]),
    )

    expect(settled).toBe('still waiting')
  })

  test('and the read is recorded, for the build to report', async () => {
    const read = await withRequest(null, async () => {
      void headers()
      await new Promise((r) => setTimeout(r, 1))

      return requestWasRead()
    })

    expect(read).toBe(true)
  })

  test('a page that reads nothing is not marked', async () => {
    const read = await withRequest(null, async () => requestWasRead())

    expect(read).toBe(false)
  })
})

describe('outside a render', () => {
  test('reading throws rather than answering for nobody', async () => {
    // Empty headers look exactly like a visitor who sent none, which is how an
    // access check accidentally passes.
    expect(headers()).rejects.toThrow('No request in scope')
    expect(cookies()).rejects.toThrow('No request in scope')
  })
})

describe('a host that forwards the parts rather than a Request', () => {
  test('keeps the cookies a rebuilt Request would have dropped', async () => {
    // What the worker behind Laravel does. `new Request(url, { headers })`
    // silently drops Cookie — it is a forbidden header name for a Headers
    // built with the request guard — so the parts travel and are read
    // directly. Bun allows the rebuild, which is why this only shows up
    // somewhere stricter, and what it loses is every cookie.
    await withRequest(
      { url: 'https://x.test/admin', headers: { cookie: 'locale=fr', 'accept-language': 'fr' } },
      async () => {
        expect((await cookies()).get('locale')).toBe('fr')
        expect((await headers()).get('accept-language')).toBe('fr')
      },
    )
  })

  test('and reports no Request object, because there is not one', async () => {
    await withRequest({ url: 'https://x.test/admin', headers: {} }, async () => {
      expect((await request())).toBeNull()
      expect((await url())).toBe('https://x.test/admin')
    })
  })
})

describe('why the reads are asynchronous', () => {
  test('a read inside a boundary suspends rather than failing the render', async () => {
    // The granularity this buys: React treats a never-settling read exactly as
    // it treats a host call that never answers, so the Suspense fallback above
    // it goes into the frozen shell and only that subtree is per-request.
    // A synchronous read could only mark the whole route dynamic — there would
    // be nothing to suspend on.
    let resolvedWithSomething = false

    await withRequest(null, () =>
      Promise.race([
        headers().then(() => {
          resolvedWithSomething = true
        }),
        new Promise((r) => setTimeout(r, 30)),
      ]),
    )

    expect(resolvedWithSomething).toBe(false)
  })

  test('and settles immediately when there is a request', async () => {
    const start = Date.now()

    await withRequest(req({ headers: { 'accept-language': 'fr' } }), async () => {
      expect((await headers()).get('accept-language')).toBe('fr')
    })

    expect(Date.now() - start).toBeLessThan(50)
  })
})
