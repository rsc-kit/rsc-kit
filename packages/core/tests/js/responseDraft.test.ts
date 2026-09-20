/**
 * Putting headers and cookies on the answer.
 *
 * There is exactly one window for it: after the request arrives and before the
 * host builds a Response. Middleware runs inside that window; a component runs
 * after it, once the headers are already on the wire. The difference is the
 * whole reason this is not simply "set a header from anywhere".
 */

import { describe, expect, test } from 'bun:test'
import { cookies, responseHeaders, serializeCookie, withRequest, withResponseDraft } from '../../src/request'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('responseDraft.test.ts')

// With a cookie header, the request is the shape a host forwards: Cookie is
// a forbidden header on a Request built in JavaScript, and would be dropped.
const inRequest = <T>(run: (draft: { taken: () => Headers; seal: () => void }) => Promise<T>, cookie?: string) =>
  withRequest(
    cookie === undefined ? new Request('https://x.test/') : { url: 'https://x.test/', headers: { cookie } },
    () => withResponseDraft(run),
  )

describe('while the response can still be changed', () => {
  test('a header set is a header taken', async () => {
    const headers = await inRequest(async ({ taken }) => {
      responseHeaders().set('X-Tenant', 'acme')

      return taken()
    })

    expect(headers.get('X-Tenant')).toBe('acme')
  })

  test('a cookie becomes a Set-Cookie', async () => {
    const headers = await inRequest(async ({ taken }) => {
      ;(await cookies()).set('session', 'abc123', { httpOnly: true, sameSite: 'lax' })

      return taken()
    })

    expect(headers.get('Set-Cookie')).toBe('session=abc123; Path=/; SameSite=Lax; HttpOnly')
  })

  test('several cookies are several headers, not the last one', async () => {
    // Set-Cookie repeats legitimately. Replacing would log someone in and then
    // immediately forget their locale.
    const headers = await inRequest(async ({ taken }) => {
      const jar = await cookies()

      jar.set('session', 'abc')
      // Next's other call shape, the one an object of options reads better in.
      jar.set({ name: 'locale', value: 'fr' })

      return taken()
    })

    expect(headers.getSetCookie()).toHaveLength(2)
  })

  test('deleting one expires it, because there is no other way to say it', async () => {
    const headers = await inRequest(async ({ taken }) => {
      ;(await cookies()).delete('session')

      return taken()
    })

    expect(headers.get('Set-Cookie')).toContain('Max-Age=0')
  })

  test('a value is encoded, so a cookie cannot forge a second one', async () => {
    const headers = await inRequest(async ({ taken }) => {
      ;(await cookies()).set('next', '/admin?a=1; evil=yes')

      return taken()
    })

    expect(headers.get('Set-Cookie')).not.toContain('evil=yes;')
    expect(headers.get('Set-Cookie')).toContain('%3B%20evil')
  })
})

describe('what the request wrote, read back', () => {
  test('a cookie set is the cookie get() answers with, for the rest of the request', async () => {
    // switchAgent: cookies().set('agent_id', id) then revalidate('all'). The
    // sections travel back with the action's answer, rendered in the same
    // request - and read the cookie the request arrived with, so the
    // sidebar showed the old agent until a reload. Next answers the written
    // value here, which is why the pattern is what every port writes.
    await inRequest(async () => {
      const jar = await cookies()

      expect(jar.get('agent_id')?.value).toBe('12')

      jar.set('agent_id', '17')

      expect(jar.get('agent_id')).toEqual({ name: 'agent_id', value: '17' })
      expect(jar.has('agent_id')).toBe(true)

      // Another call in the same request - a component rendering after the
      // action - sees it too.
      expect((await cookies()).get('agent_id')?.value).toBe('17')
      expect((await cookies()).getAll()).toEqual([{ name: 'agent_id', value: '17' }])
    }, 'agent_id=12')
  })

  test('a cookie deleted is gone from get(), has() and getAll()', async () => {
    await inRequest(async () => {
      const jar = await cookies()

      jar.delete('session')

      expect(jar.get('session')).toBeUndefined()
      expect(jar.has('session')).toBe(false)
      expect((await cookies()).getAll()).toEqual([{ name: 'theme', value: 'dark' }])

      // Set again after the deletion: the later write wins.
      jar.set('session', 'new')

      expect((await cookies()).get('session')?.value).toBe('new')
    }, 'session=old; theme=dark')
  })

  test('a cookie set to expire in the past reads as gone', async () => {
    await inRequest(async ({ taken }) => {
      const jar = await cookies()

      jar.set('session', 'x', { expires: new Date(Date.now() - 1000) })

      expect(jar.has('session')).toBe(false)
      // And the header is written: a date has commas in it by definition,
      // and the separator check used to refuse every Expires.
      expect(taken().get('Set-Cookie')).toContain('Expires=')
    }, 'session=old')
  })

  test('a cookie set to expire in the future is still there', async () => {
    await inRequest(async ({ taken }) => {
      const jar = await cookies()

      jar.set('remember', 'yes', { expires: new Date(Date.now() + 86_400_000) })

      expect(jar.get('remember')?.value).toBe('yes')
      expect(taken().get('Set-Cookie')).toMatch(/Expires=\w{3}, \d{2} \w{3} \d{4}/)
    })
  })

  test('and the next request starts from what it arrived with', async () => {
    await inRequest(async () => {
      ;(await cookies()).set('agent_id', '17')
    }, 'agent_id=12')

    await inRequest(async () => {
      expect((await cookies()).get('agent_id')?.value).toBe('12')
    }, 'agent_id=12')
  })
})

describe('once it has been sent', () => {
  test('setting a header is refused rather than dropped', async () => {
    // What a component would hit. Silently collecting it would look like it
    // worked, right up until someone checked the response.
    await inRequest(async ({ seal }) => {
      seal()

      expect(() => responseHeaders().set('X-Late', 'no')).toThrow(/after the response had been sent/)
    })
  })

  test('and the message says where to put it instead', async () => {
    await inRequest(async ({ seal }) => {
      seal()

      expect(() => responseHeaders().set('X-Late', 'no')).toThrow(/middleware/)
    })
  })
})

describe('outside a request', () => {
  test('there is nothing to put a header on, and it says so', () => {
    expect(() => responseHeaders()).toThrow(/needs a response/)
  })
})

describe('the cookie itself', () => {
  test('gets Path=/ by default', () => {
    // Without one a browser scopes it to the path that set it — a session
    // written by POST /_rsc/action would not be sent for any page.
    expect(serializeCookie({ name: 'a', value: 'b', options: {} })).toBe('a=b; Path=/')
  })

  test('carries the attributes it was given', () => {
    const header = serializeCookie({
      name: 'session',
      value: 'x',
      options: { maxAge: 3600, secure: true, httpOnly: true, sameSite: 'strict', domain: 'x.test' },
    })

    expect(header).toContain('Max-Age=3600')
    expect(header).toContain('Domain=x.test')
    expect(header).toContain('SameSite=Strict')
    expect(header).toContain('Secure')
    expect(header).toContain('HttpOnly')
  })
})

describe('a cookie name is a token, and nothing escapes it', () => {
  // An app deriving a name from user input — `pref_${key}` — would otherwise
  // let that input close the pair and open another. A browser reads the first
  // name=value it sees, so the forged one wins.
  test('a name carrying its own attributes is refused', () => {
    expect(() =>
      serializeCookie({ name: 'session=attacker; Path=/; HttpOnly; x', value: 'v', options: {} }),
    ).toThrow(/not a usable cookie name/i)
  })

  test('and so is one with a space or a semicolon in it', () => {
    expect(() => serializeCookie({ name: 'a b', value: 'v', options: {} })).toThrow()
    expect(() => serializeCookie({ name: 'a;b', value: 'v', options: {} })).toThrow()
  })

  test('an ordinary name still works', () => {
    expect(serializeCookie({ name: 'pref_theme', value: 'dark', options: {} })).toBe(
      'pref_theme=dark; Path=/',
    )
  })

  test('a path or domain cannot smuggle further attributes', () => {
    expect(() =>
      serializeCookie({ name: 'a', value: 'b', options: { path: '/; Domain=attacker.test' } }),
    ).toThrow(/separator/i)

    expect(() =>
      serializeCookie({ name: 'a', value: 'b', options: { domain: 'x.test; Secure' } }),
    ).toThrow(/separator/i)
  })
})

describe('a header object held past the response', () => {
  test('refuses writes rather than accepting ones nobody reads', async () => {
    // Holding the Headers across an await and writing to it later used to
    // succeed silently — the host had already copied them onto the response.
    await withRequest(new Request('https://x.test/'), () =>
      withResponseDraft(async ({ seal }) => {
        const held = responseHeaders()

        held.set('X-Early', 'yes')
        seal()

        expect(() => held.set('X-Late', 'no')).toThrow(/after the response had been sent/)
        expect(held.get('X-Early')).toBe('yes')
      }),
    )
  })
})
