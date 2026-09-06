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
  test('the names from route.ts, outermost first, on a reserved function', async () => {
    const asked = hostAnswering(true)

    await guarded()

    expect(asked).toHaveLength(1)
    expect(asked[0].name).toBe('__rsc.middleware')
    // Arguments after a colon survive intact — the reason the parser reads
    // quoted literals rather than splitting the list on commas.
    expect(asked[0].args[0]).toEqual(['auth', 'can:view,admin', 'throttle:60,1'])
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
