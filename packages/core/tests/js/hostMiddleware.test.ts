// Guards the host runs, and what happens when it cannot be asked.
//
// This is the mechanism that replaces route.php's middleware() and can() once
// the engine owns the route table. Its correctness is not "does it work" — it
// is that every way of NOT getting a yes is a refusal. The call crosses a
// process boundary, so it can time out, be refused, answer nonsense, or find
// no host at all, and each of those renders a guarded page to a stranger if
// the absence of a no is read as a yes.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { buildFixtureOnce, bundlePath } from './goHost'

let engine: any

beforeAll(async () => {
  await buildFixtureOnce()
  engine = await import(bundlePath)
}, 180_000)

afterAll(() => {
  // Left installed, this leaks into every file that shares the bundle.
  engine?.installHostFn(async () => null)
})

/** Install a host that answers the middleware call with `answer`. */
function hostAnswering(answer: unknown | (() => unknown)) {
  const asked: Array<{ name: string; args: unknown[] }> = []

  engine.installHostFn(async (name: string, ...args: unknown[]) => {
    asked.push({ name, args })

    return typeof answer === 'function' ? (answer as () => unknown)() : answer
  })

  return asked
}

const guarded = () => engine.runRouteMiddleware('app/host-guard/page', {})

describe('what the host is asked', () => {
  test('middleware.ts may name the guards instead of route.ts, with no default export', async () => {
    const asked = hostAnswering(true)

    await engine.runRouteMiddleware('app/host-guard-file/page', {})

    expect(asked).toHaveLength(1)
    expect(asked[0].name).toBe('__rsc.middleware')
    expect(asked[0].args[0]).toEqual(['auth', 'can:view,admin'])
  })

  test('the names from route.ts, outermost first, on a reserved function', async () => {
    const asked = hostAnswering(true)

    await guarded()

    expect(asked).toHaveLength(1)
    expect(asked[0].name).toBe('__rsc.middleware')
    // Arguments after a colon survive intact — the reason the parser reads
    // quoted literals rather than splitting the list on commas.
    expect(asked[0].args[0]).toEqual(['auth', 'can:view,admin', 'throttle:60,1'])
  })

  // What the page is, beside the names: the call is a POST to the backend's
  // own endpoint, so a middleware reading the request it runs under saw that
  // instead - `signed` checked the endpoint's url, `can:update,invoice` had
  // no {invoice}.
  test('the page the names are about, as a second argument', async () => {
    const asked = hostAnswering(true)

    await engine.runRouteMiddleware('app/host-guard-orders/[order]/page', { order: '42', tab: 'items', skipped: { x: 1 } })

    // Only what the route binds: a page's props carry its query beside its
    // params, and ?order=8 must never stand in for {order}.
    expect(asked[0].args[0]).toEqual(['can:view,order'])
    expect(asked[0].args[1]).toEqual({ url: null, params: { order: '42' } })
  })

  test('the url is the visitor\'s, under the host a proxy forwarded', async () => {
    const asked = hostAnswering(true)
    const { withRequest } = await import('../../src/request')

    await withRequest(
      new Request('http://127.0.0.1:3000/owner-verification/5?expires=1&signature=abc', {
        headers: { 'x-forwarded-host': 'app.example.com', 'x-forwarded-proto': 'https' },
      }),
      () => engine.runRouteMiddleware('app/host-guard/page', {}),
    )

    expect(asked[0].args[1]).toEqual({
      url: 'https://app.example.com/owner-verification/5?expires=1&signature=abc',
      params: {},
    })
  })

  // A stored page is guarded before the store is looked in, and when nothing
  // is stored the render guards it again: throttle:6,1 counted every visit twice.
  test('one request asks once for the same page', async () => {
    const asked = hostAnswering(true)
    const { withRequest } = await import('../../src/request')

    await withRequest(new Request('http://app.test/host-guard'), async () => {
      await engine.runRouteMiddleware('app/host-guard/page', {})
      await engine.runRouteMiddleware('app/host-guard/page', {})
    })

    expect(asked).toHaveLength(1)

    // A second request is a second visit, asked again.
    await withRequest(new Request('http://app.test/host-guard'), () => engine.runRouteMiddleware('app/host-guard/page', {}))

    expect(asked).toHaveLength(2)
  })

  test('a refusal is never remembered as a pass', async () => {
    let answer: unknown = 'no'
    const asked = hostAnswering(() => answer)
    const { withRequest } = await import('../../src/request')

    await withRequest(new Request('http://app.test/host-guard'), async () => {
      await expect(engine.runRouteMiddleware('app/host-guard/page', {})).rejects.toThrow()
      answer = true
      await engine.runRouteMiddleware('app/host-guard/page', {})
    })

    expect(asked).toHaveLength(2)
  })

  test('a route naming none asks nothing at all', async () => {
    const asked = hostAnswering(true)

    await engine.runRouteMiddleware('app/static/page', {})

    expect(asked).toHaveLength(0)
  })
})

describe('only a yes is a yes', () => {
  test('true renders', async () => {
    hostAnswering(true)

    await expect(guarded()).resolves.toBeUndefined()
  })

  // Each of these is a way a real host fails, and each would render the page
  // if the check were `if (answer === false) refuse`.
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['false', false],
    ['the string "true"', 'true'],
    ['an empty object', {}],
    ['an object that looks like a result', { allowed: true }],
    ['the number 1', 1],
  ])('%s refuses', async (_label, answer) => {
    hostAnswering(answer)

    await expect(guarded()).rejects.toThrow(/refused app\/host-guard\/page/)
  })

  test('a host that throws refuses', async () => {
    hostAnswering(() => {
      throw new Error('connect ECONNREFUSED')
    })

    await expect(guarded()).rejects.toThrow()
  })

  test('no host installed at all refuses, and says why', async () => {
    // The uninstall path: a prerender that shares this engine, or a host that
    // has not wired its callable yet. A guarded route must not render because
    // there was nobody to ask.
    engine.installHostFn(null)

    await expect(guarded()).rejects.toThrow(/no host callable is installed/)
  })
})

describe('the guard runs before anything renders', () => {
  test('a refused document never reaches React', async () => {
    hostAnswering(false)

    await expect(
      engine.handleRscHtmlStream('app/host-guard/page', {}, [], [], {}, {}, undefined, '/host-guard'),
    ).rejects.toThrow(/refused/)
  })

  test('a refused payload is refused too, not just the document', async () => {
    // The narrowing headers in PROTOCOL.md Part 3b are exactly this attack:
    // ask for less of a page and see whether less of it is guarded.
    hostAnswering(false)

    await expect(
      engine.handleRscStream('app/host-guard/page', {}, [], [], {}, {}, 0, '/host-guard'),
    ).rejects.toThrow(/refused/)
  })
})

describe('several checks in one directory', () => {
  test('run in the order written, and stop at the first refusal', async () => {
    // A list is the default export - reused checks imported from one place -
    // and the third is never asked once the second has said no.
    const { withRedirect } = await import('../../src/redirect')
    const refused = await withRedirect(async (taken) => {
      await engine.runRouteMiddleware('app/guarded-twice/page', {}).catch(() => {})

      return taken()
    })

    expect(refused?.location).toBe('/login')
    expect((globalThis as { __guardedTwice?: string[] }).__guardedTwice).toEqual(['first', 'second'])
  })
})
