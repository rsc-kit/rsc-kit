/**
 * Defence in depth on a server action.
 *
 * An action already requires the X-RSC-Action header, which makes a
 * cross-origin post a non-simple request: the browser preflights it, and
 * nothing here answers a preflight. A browser can be tricked into sending
 * cookies; it cannot be tricked into sending a header it does not know. This is
 * the belt to that pair of braces, and what Next does for server actions.
 *
 * Tested against the predicate rather than through a handler, deliberately. Two
 * other files in this suite register happy-dom globally, which replaces Request
 * — and a test whose result depends on which file ran first is not a test of
 * this at all.
 */

import { describe, expect, test } from 'bun:test'
import { originAllowed } from '../../src/host'

const from = (headers: Record<string, string>): Request =>
  ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as Request

const url = new URL('http://renderer.test/_rsc/action')

describe('where a post is allowed to come from', () => {
  test('a matching origin is allowed', () => {
    expect(originAllowed(from({ origin: 'http://renderer.test', host: 'renderer.test' }), url)).toBe(true)
  })

  test('another site is refused', () => {
    expect(originAllowed(from({ origin: 'https://evil.example', host: 'renderer.test' }), url)).toBe(false)
  })

  test('no origin at all is allowed', () => {
    // Absent on same-origin requests in some browsers, and on everything that
    // is not one. Refusing those breaks server-to-server callers to stop an
    // attacker the preflight has already stopped.
    expect(originAllowed(from({ host: 'renderer.test' }), url)).toBe(true)
  })

  test('a proxied request is judged on the name the visitor typed', () => {
    // The normal deployment, and the case that makes this worse than useless if
    // got wrong: Host here is this process on loopback, while the visitor typed
    // something else. Comparing against Host alone refuses every legitimate
    // action that arrived through a backend's proxy.
    expect(
      originAllowed(
        from({ origin: 'http://my-app.test', host: '127.0.0.1:5173', 'x-forwarded-host': 'my-app.test' }),
        url,
      ),
    ).toBe(true)
  })

  test('and a forged origin behind that proxy is still refused', () => {
    expect(
      originAllowed(
        from({ origin: 'https://evil.example', host: '127.0.0.1:5173', 'x-forwarded-host': 'my-app.test' }),
        url,
      ),
    ).toBe(false)
  })

  test('an Origin that is not a url is refused', () => {
    // "null" is what a sandboxed iframe or a redirected cross-site post sends.
    expect(originAllowed(from({ origin: 'null', host: 'renderer.test' }), url)).toBe(false)
  })

  test('falls back to the url when a request carries no host header at all', () => {
    expect(originAllowed(from({ origin: 'http://renderer.test' }), url)).toBe(true)
  })
})

describe('Sec-Fetch-Site, which a browser sets and a page cannot', () => {
  test('same-origin passes, whatever a proxy did to Host', () => {
    // A proxy that forwards no X-Forwarded-Host leaves nothing to compare
    // Origin with; the browser has already said where the post came from.
    expect(originAllowed(from({ 'sec-fetch-site': 'same-origin', origin: 'https://my-app.test', host: '127.0.0.1:5173' }), url)).toBe(true)
    expect(originAllowed(from({ 'sec-fetch-site': 'none', host: 'renderer.test' }), url)).toBe(true)
  })

  test('cross-site and same-site are refused, even with an Origin that would have matched', () => {
    expect(originAllowed(from({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', host: 'renderer.test' }), url)).toBe(false)
    expect(originAllowed(from({ 'sec-fetch-site': 'same-site', origin: 'http://other.renderer.test', host: 'renderer.test' }), url)).toBe(false)
    expect(originAllowed(from({ 'sec-fetch-site': 'cross-site', host: 'renderer.test' }), url)).toBe(false)
  })

  test('a trusted origin passes from another site', () => {
    const trusted = ['https://admin.example.com']
    const admin = from({ 'sec-fetch-site': 'cross-site', origin: 'https://admin.example.com', host: 'renderer.test' })

    expect(originAllowed(admin, url, trusted)).toBe(true)
    expect(originAllowed(from({ origin: 'https://admin.example.com', host: 'renderer.test' }), url, trusted)).toBe(true)
    expect(originAllowed(from({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', host: 'renderer.test' }), url, trusted)).toBe(false)
  })
})
