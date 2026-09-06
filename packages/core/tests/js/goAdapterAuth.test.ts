// Can authorization live in Go?
//
// The Laravel host does this in route.php — middleware() and can() — which is
// machinery a Go host has no equivalent of, and the fair reason to doubt this
// whole arrangement: rendering was the easy half, and a page nobody can guard
// is not a page anyone ships.
//
// The engine's answer is a middleware.ts in the app tree, run before anything
// at or below it renders. Whether that is a real answer turns on one thing
// nothing else covers: whether a guard can reach the backend, with the
// visitor's own cookie, and refuse.
//
// It shares goAdapterRender's build deliberately. Only ONE @vitejs/plugin-rsc
// bundle can be live in a process: client references live in a global registry
// keyed by id, so a second bundle evicts the first one's components and the
// symptom lands somewhere else entirely — every route in prerender.test.ts
// failing with "client reference not found".

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRscHandler } from '../../src/host'
import { httpHostCalls } from '../../src/hostCalls'
import { buildFixtureOnce, bundlePath, startGoHost, realFetch } from './goHost'

const hasGo = Bun.which('go') !== null
const SECRET = 'auth-secret'

let handle: (request: Request) => Promise<Response | null>
let stop: (() => void) | null = null
let asked: string[] = []

beforeAll(async () => {
  if (!hasGo) return

  await buildFixtureOnce()

  const { address, kill } = await startGoHost(SECRET)
  stop = kill

  const engine = await import(bundlePath)

  handle = createRscHandler({
    engine,
    hostCalls: (name, ...args) => {
      asked.push(name)

      return httpHostCalls({
        endpoint: `${address}/__rsc/host-call`,
        secret: SECRET,
        fetch: realFetch,
      })(name, ...args)
    },
  })
}, 180_000)

afterAll(() => stop?.())

describe.skipIf(!hasGo)('authorization decided in Go', () => {
  test('an unguarded page renders without consulting the guard', async () => {
    asked = []
    await handle(new Request('http://app.test/static'))

    expect(asked).not.toContain('Auth.check')
  })

  // Auth.check in the Go example reads the forwarded cookie. No cookie, no
  // session, and the guard sends the visitor to /login.
  test('a guard reaches Go and refuses, before the page renders', async () => {
    asked = []
    const response = await handle(new Request('http://app.test/hosted-guard'))

    expect(asked).toContain('Auth.check')
    // 307, not 302: the engine's redirect preserves the method, so a guarded
    // POST does not quietly become a GET of the login page.
    expect(response?.status).toBe(307)
    expect(response?.headers.get('Location')).toBe('/login')
  })

  // Authorization rather than Cookie, and not by preference.
  //
  // happy-dom is registered process-wide by the DOM tests, and its Request
  // enforces the browser's forbidden-header list — so `new Request(url, {
  // headers: { cookie } })` silently drops it and this guard sees an anonymous
  // visitor. Alone the file passes; in the suite it does not, and the failure
  // says nothing about headers. Cookie forwarding is covered in
  // hostCalls.test.ts, which builds its scope from a plain object and is not
  // subject to any of this.
  test('with the visitor credential, the same guard lets them through', async () => {
    asked = []
    const response = await handle(
      new Request('http://app.test/hosted-guard', { headers: { authorization: 'Bearer valid' } }),
    )

    expect(asked).toContain('Auth.check')
    expect(response?.status).toBe(200)
    expect(await response!.text()).toContain('only for a signed-in visitor')
  })

  // The guarded page must not be reachable by asking for less of it — the
  // narrowing headers in PROTOCOL.md Part 3b are exactly this attack.
  test('a payload request cannot skip the guard', async () => {
    const response = await handle(
      new Request('http://app.test/hosted-guard', {
        headers: { 'X-RSC': '1', 'X-RSC-Segments': 'app/layout' },
      }),
    )

    expect(await response!.text()).not.toContain('only for a signed-in visitor')
  })
})
