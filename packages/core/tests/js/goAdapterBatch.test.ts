// Sibling reads travel as one request.
//
// Three server components on one page each await rpc(). React renders
// siblings concurrently, so the calls are issued in the same tick; the
// transport puts them in one POST, and the Go host answers each in order.
// What is proved is the whole path: the engine's render issues them together,
// the wire carries one envelope, and every component gets its own answer.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { httpHostCalls } from '../../src/hostCalls'
import { buildFixtureOnce, bundlePath, startGoHost, realFetch } from './goHost'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('goAdapterBatch.test.ts')

const hasGo = Bun.which('go') !== null
const SECRET = 'batch-secret'

let handle: (request: Request) => Promise<Response | null>
let stop: (() => void) | null = null
let posted: unknown[] = []

beforeAll(async () => {
  if (!hasGo) return

  await buildFixtureOnce()

  const { address, kill } = await startGoHost(SECRET)
  stop = kill

  const engine = await import(bundlePath)

  handle = createRscHandler({
    engine,
    hostCalls: httpHostCalls({
      endpoint: `${address}/__rsc/host-call`,
      secret: SECRET,
      fetch: ((url: unknown, init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))

        return realFetch(url as string, init)
      }) as typeof fetch,
    }),
  })
}, 180_000)

afterAll(() => stop?.())

describe.skipIf(!hasGo)('host calls batched through Go', () => {
  test('three sibling reads are one request, and each component gets its answer', async () => {
    posted = []

    const response = await handle(
      new Request('http://app.test/batched', { headers: { cookie: 'session=valid' } }),
    )
    const html = await response!.text()

    expect(response?.status).toBe(200)
    expect(html.replace(/<!-- -->/g, '')).toContain('2 orders')
    expect(html).toContain('ada via go')
    expect(html).toContain('session=valid')

    const batches = posted.filter((b: any) => Array.isArray(b.calls)) as { calls: { function: string }[] }[]

    expect(batches).toHaveLength(1)
    expect(batches[0].calls.map((c) => c.function).sort()).toEqual(['Me.session', 'Orders.recent', 'getUser'])
    // And nothing went alone.
    expect(posted).toHaveLength(1)
  })
})
