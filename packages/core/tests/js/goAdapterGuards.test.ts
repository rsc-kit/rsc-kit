// Route middleware decided in Go.
//
// app/host-guard/route.ts names ['auth', 'can:view,admin', 'throttle:60,1']
// and declares nothing else - no JavaScript guard, no route in Go. The
// renderer sends the list to the reserved function before the page renders,
// and the Go side runs its own guards by those names. What is proved here is
// the whole path: the names leave the engine, the guards run in Go, a refusal
// comes back as its own kind, and the visitor's credential lets them through.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { httpHostCalls } from '../../src/hostCalls'
import { buildFixtureOnce, bundlePath, startGoHost, realFetch } from './goHost'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('goAdapterGuards.test.ts')

const hasGo = Bun.which('go') !== null
const SECRET = 'guards-secret'

let handle: (request: Request) => Promise<Response | null>
let stop: (() => void) | null = null
let asked: { name: string; args: unknown[] }[] = []

beforeAll(async () => {
  if (!hasGo) return

  await buildFixtureOnce()

  const { address, kill } = await startGoHost(SECRET)
  stop = kill

  const engine = await import(bundlePath)

  handle = createRscHandler({
    engine,
    hostCalls: (name, ...args) => {
      asked.push({ name, args })

      return httpHostCalls({
        endpoint: `${address}/__rsc/host-call`,
        secret: SECRET,
        fetch: realFetch,
      })(name, ...args)
    },
  })
}, 180_000)

afterAll(() => stop?.())

describe.skipIf(!hasGo)('route middleware answered by Go', () => {
  test('the names in route.ts reach Go as one reserved call, intact', async () => {
    asked = []

    await handle(new Request('http://app.test/host-guard'))

    const call = asked.find((c) => c.name === '__rsc.middleware')

    expect(call).toBeDefined()
    // throttle:60,1 arrives whole - a list split on commas would hand Go a
    // throttle of 60 and a guard called 1.
    expect(call!.args).toEqual([['auth', 'can:view,admin', 'throttle:60,1']])
  })

  test('a guard refusing in Go answers the page with its kind, before rendering', async () => {
    const response = await handle(new Request('http://app.test/host-guard'))

    // The Go auth guard answered Redirect('/login'); it reaches the browser as
    // a real redirect, not a 500 and not a rendered page.
    expect(response?.status).toBe(307)
    expect(response?.headers.get('Location')).toBe('/login')
  })

  test('with the credential, the same guards let the page render', async () => {
    const response = await handle(
      new Request('http://app.test/host-guard', { headers: { authorization: 'Bearer valid' } }),
    )

    expect(response?.status).toBe(200)
    expect(await response!.text()).toContain('only past the host guard')
  })

  test('a payload request runs the same guards', async () => {
    const response = await handle(
      new Request('http://app.test/host-guard', {
        headers: { 'X-RSC': '1', 'X-RSC-Segments': 'app/layout' },
      }),
    )

    expect(await response!.text()).not.toContain('only past the host guard')
  })
})
