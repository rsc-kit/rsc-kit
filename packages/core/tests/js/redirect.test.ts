/**
 * Redirecting out of a render.
 *
 * The behaviour worth pinning is not that it redirects — it is *which of two
 * ways* it redirects, because that is decided by where the call happened and
 * it is the difference between a page the browser never sees and a page it
 * sees the shell of.
 */

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { redirect, withRedirect } from '../../src/redirect'
import {
  isRedirectSignal,
  parseRedirectDigest,
  redirectDigest,
  RedirectSignal,
} from '../../src/redirectDigest'
import type { RouteManifest } from '../../src/manifest'

function manifestFor(): RouteManifest {
  return {
    version: 'build-1',
    routes: [
      {
        url: '/account',
        component: 'app/account/page',
        segments: [{ type: 'static', value: 'account' }],
        layouts: ['app/layout'],
        loadings: [],
        slots: {},
        sections: [],
        config: null,
        ancestorConfigs: [],
        staticParams: false,
        clientJs: true,
      },
    ],
    intercepts: [],
  } as unknown as RouteManifest
}

const empty = () => new ReadableStream({ start: (c) => c.close() })

const textStream = (text: string) =>
  new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(text))
      c.close()
    },
  })

/**
 * @param when 'shell'  the render redirects before returning its stream
 *             'late'   it returns a stream and redirects while producing it
 *             'never'  an ordinary render
 */
function engineThat(when: 'shell' | 'late' | 'never', to = '/login') {
  return {
    manifest: () => manifestFor(),
    installHostFn: () => () => {},
    async handleRscHtmlStream() {
      // Above every boundary: React cannot finish the shell, so the promise
      // for it rejects and nothing has been written.
      if (when === 'shell') redirect(to)

      if (when === 'late') {
        // Inside a boundary: the shell is handed over first, and the redirect
        // is decided while the rest of the stream is still being produced.
        return {
          htmlStream: new ReadableStream({
            start(c: ReadableStreamDefaultController) {
              c.enqueue(new TextEncoder().encode('<!doctype html><p>shell</p>'))
            },
            pull(c: ReadableStreamDefaultController) {
              try {
                redirect(to)
              } catch {
                // Recorded. React swallows it the same way, into the
                // boundary's error digest.
              }

              c.close()
            },
          }),
        }
      }

      return { htmlStream: textStream('<!doctype html><p>shell</p>') }
    },
    async handleRscStream(
      _component: string,
      _props: unknown,
      _layouts: unknown,
      _loadings: unknown,
      _slots: unknown,
      _overrides: unknown,
      from: number,
    ) {
      if (when === 'shell') redirect(to)

      return { stream: empty(), segmentDepth: from }
    },
  }
}

describe('the signal', () => {
  test('is recognised across copies of the module', () => {
    // What a second bundled copy of the class produces: same shape, same
    // marker, different constructor. `instanceof` says no; this must not.
    const fromAnotherBundle = Object.assign(new Error('Redirect to /x'), {
      name: 'RedirectSignal',
      location: '/x',
      status: 307,
      [Symbol.for('@rsc-kit/core.redirect-signal')]: true,
    })

    expect(fromAnotherBundle instanceof RedirectSignal).toBe(false)
    expect(isRedirectSignal(fromAnotherBundle)).toBe(true)
  })

  test('an ordinary error is not one', () => {
    expect(isRedirectSignal(new Error('nope'))).toBe(false)
    expect(isRedirectSignal(null)).toBe(false)
    expect(isRedirectSignal('/login')).toBe(false)
  })

  test('survives the digest round trip', () => {
    const digest = redirectDigest(new RedirectSignal('/login?next=/a;b', 303))

    expect(parseRedirectDigest(digest)).toEqual({ location: '/login?next=/a;b', status: 303 })
  })

  test('any other digest is left alone', () => {
    expect(parseRedirectDigest('a1b2c3')).toBeNull()
    expect(parseRedirectDigest(undefined)).toBeNull()
  })
})

describe('recording one', () => {
  test('is scoped to the render that asked', async () => {
    const taken = await withRedirect(async (read) => {
      try {
        redirect('/login')
      } catch {
        // expected
      }

      return read()
    })

    expect(taken).toEqual({ location: '/login', status: 307 })
  })

  test('the outermost wins, not the last to finish', async () => {
    const taken = await withRedirect(async (read) => {
      for (const to of ['/first', '/second']) {
        try {
          redirect(to)
        } catch {
          // expected
        }
      }

      return read()
    })

    expect(taken?.location).toBe('/first')
  })

  test('outside a render it still throws, so nothing continues past it', () => {
    expect(() => redirect('/login')).toThrow('Redirect to /login')
  })
})

describe('a redirect decided before the shell', () => {
  test('a document gets a real status code and never sees the page', async () => {
    const handle = createRscHandler({ engine: engineThat('shell') as never })
    const response = await handle(new Request('https://x.test/account'))

    expect(response!.status).toBe(307)
    expect(response!.headers.get('Location')).toBe('/login')
    expect(await response!.text()).toBe('')
  })

  test('the status is the caller\'s to choose', async () => {
    const engine = {
      ...engineThat('shell'),
      handleRscHtmlStream: async () => redirect('/moved', 308),
    }

    const response = await createRscHandler({ engine: engine as never })(
      new Request('https://x.test/account'),
    )

    expect(response!.status).toBe(308)
    expect(response!.headers.get('Location')).toBe('/moved')
  })

  test('a navigation gets a header instead, because fetch follows a 3xx', async () => {
    // Following it would hand the destination's HTML to the Flight decoder,
    // which reports its own confusion rather than the redirect.
    const handle = createRscHandler({ engine: engineThat('shell') as never })
    const response = await handle(
      new Request('https://x.test/account', { headers: { 'X-RSC': 'true' } }),
    )

    expect(response!.status).toBe(204)
    expect(response!.headers.get('X-RSC-Redirect')).toBe('/login')
    expect(response!.headers.get('Location')).toBeNull()
  })

  test('is answered even when React re-raised its own error', async () => {
    // What actually happens in production: React catches the signal a
    // component threw and raises a generic render failure whose message is
    // stripped. Testing the caught value for a redirect finds nothing — the
    // destination is in the scope, and reading the error instead answers 500
    // with the redirect sitting there unread.
    const engine = {
      ...engineThat('shell'),
      async handleRscHtmlStream() {
        try {
          redirect('/login')
        } catch {
          throw new Error(
            'An error occurred in the Server Components render. The specific message is omitted in production builds.',
          )
        }
      },
    }

    const response = await createRscHandler({ engine: engine as never })(
      new Request('https://x.test/account'),
    )

    expect(response!.status).toBe(307)
    expect(response!.headers.get('Location')).toBe('/login')
  })

  test('a render that fails for any other reason still fails', async () => {
    const engine = {
      ...engineThat('never'),
      async handleRscHtmlStream() {
        throw new Error('the database is on fire')
      },
    }

    const handle = createRscHandler({ engine: engine as never })

    expect(handle(new Request('https://x.test/account'))).rejects.toThrow('the database is on fire')
  })

  test('both answers vary on the header that chose between them', async () => {
    const handle = createRscHandler({ engine: engineThat('shell') as never })

    for (const headers of [{}, { 'X-RSC': 'true' }] as Record<string, string>[]) {
      const response = await handle(new Request('https://x.test/account', { headers }))

      // Contains, not equals: the answer also varies on the headers that choose
      // between a document, a partial, a named region and an interceptor.
      expect(response!.headers.get('Vary')).toContain('X-RSC')
    }
  })
})

describe('a redirect decided after the shell', () => {
  test('travels in the body, because the status line is already spent', async () => {
    const handle = createRscHandler({ engine: engineThat('late') as never })
    const response = await handle(new Request('https://x.test/account'))
    const body = await response!.text()

    expect(response!.status).toBe(200)
    expect(body).toContain('<p>shell</p>')
    expect(body).toContain('location.replace("/login")')
  })

  test('the shell it already sent is still the shell', async () => {
    // Not truncated, not replaced. Whatever painted stays painted; the
    // redirect is appended to it.
    const handle = createRscHandler({ engine: engineThat('late') as never })
    const body = await (await handle(new Request('https://x.test/account')))!.text()

    expect(body.indexOf('<p>shell</p>')).toBeLessThan(body.indexOf('location.replace'))
  })
})

describe('a render that does not redirect', () => {
  test('is untouched', async () => {
    const handle = createRscHandler({ engine: engineThat('never') as never })
    const response = await handle(new Request('https://x.test/account'))

    expect(response!.status).toBe(200)
    expect(await response!.text()).toBe('<!doctype html><p>shell</p>')
  })
})
