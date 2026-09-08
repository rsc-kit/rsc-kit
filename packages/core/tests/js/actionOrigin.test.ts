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
import { actionOriginAllowed } from '../../src/host'

const from = (headers: Record<string, string>): Request =>
  ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as Request

const url = new URL('http://renderer.test/_rsc/action')

describe('where an action is allowed to come from', () => {
  test('a matching origin is allowed', () => {
    expect(actionOriginAllowed(from({ origin: 'http://renderer.test', host: 'renderer.test' }), url)).toBe(true)
  })

  test('another site is refused', () => {
    expect(actionOriginAllowed(from({ origin: 'https://evil.example', host: 'renderer.test' }), url)).toBe(false)
  })

  test('no origin at all is allowed', () => {
    // Absent on same-origin requests in some browsers, and on everything that
    // is not one. Refusing those breaks server-to-server callers to stop an
    // attacker the preflight has already stopped.
    expect(actionOriginAllowed(from({ host: 'renderer.test' }), url)).toBe(true)
  })

  test('a proxied request is judged on the name the visitor typed', () => {
    // The normal deployment, and the case that makes this worse than useless if
    // got wrong: Host here is this process on loopback, while the visitor typed
    // something else. Comparing against Host alone refuses every legitimate
    // action that arrived through a backend's proxy.
    expect(
      actionOriginAllowed(
        from({ origin: 'http://my-app.test', host: '127.0.0.1:5173', 'x-forwarded-host': 'my-app.test' }),
        url,
      ),
    ).toBe(true)
  })

  test('and a forged origin behind that proxy is still refused', () => {
    expect(
      actionOriginAllowed(
        from({ origin: 'https://evil.example', host: '127.0.0.1:5173', 'x-forwarded-host': 'my-app.test' }),
        url,
      ),
    ).toBe(false)
  })

  test('an Origin that is not a url is refused', () => {
    // "null" is what a sandboxed iframe or a redirected cross-site post sends.
    expect(actionOriginAllowed(from({ origin: 'null', host: 'renderer.test' }), url)).toBe(false)
  })

  test('falls back to the url when a request carries no host header at all', () => {
    expect(actionOriginAllowed(from({ origin: 'http://renderer.test' }), url)).toBe(true)
  })
})
