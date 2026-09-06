// End to end: the JS renderer's host calls answered by a Go process.
//
// Both halves have their own tests against a stand-in — the transport against
// a fake fetch, the Go handler against httptest. Neither can catch a
// disagreement between them, which is the only thing that matters here: a
// header named differently on each side, an error shape one of them does not
// recognise, a result the other unwraps wrongly. So this runs the real Go
// binary and talks to it over a real socket.
//
// Skipped when the Go toolchain is absent, so the suite still runs on a
// machine that only has bun.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { httpHostCalls } from '../../src/hostCalls'
import { withRequest } from '../../src/request'

const adapterDir = join(import.meta.dir, '../../../../adapters/go')
const hasGo = Bun.which('go') !== null

let endpoint = ''
let server: ReturnType<typeof Bun.spawn> | null = null
let workDir = ''

// happy-dom, registered by the DOM tests in this suite, replaces several
// globals for the whole process — fetch, which then blocks a plain-http
// request from a page it considers https, and AbortController, whose signal
// the runtime's own fetch will not accept. Both are still installed by the
// time these files run.
//
// So these ask for the runtime's fetch by name, and drop the signal: what is
// under test here is the round trip to Go, and the timeout path has its own
// coverage in hostCalls.test.ts against a stub, where no real socket is
// involved and no global is in the way.
const realFetch = ((url: unknown, init: Record<string, unknown> = {}) =>
  Bun.fetch(url as string, { ...init, signal: undefined })) as unknown as typeof fetch

const SECRET = 'e2e-secret'

beforeAll(async () => {
  if (!hasGo) return

  workDir = mkdtempSync(join(tmpdir(), 'rsckit-go-'))
  const binary = join(workDir, 'hostserver')

  const built = Bun.spawnSync(['go', 'build', '-o', binary, './examples/hostserver'], {
    cwd: adapterDir,
    stderr: 'pipe',
  })

  if (built.exitCode !== 0) {
    throw new Error(`go build failed: ${built.stderr.toString()}`)
  }

  server = Bun.spawn([binary, '-secret', SECRET, '-addr', '127.0.0.1:0'], { stdout: 'pipe' })

  // The server prints its address before it serves, so this is a handshake
  // rather than a sleep — no race, and no fixed delay to tune.
  // Bun types stdout as a number when it is inherited; 'pipe' makes it a
  // stream, and the spawn above says so.
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let banner = ''

  while (!banner.includes('\n')) {
    const { value, done } = await reader.read()
    if (done) break
    banner += decoder.decode(value, { stream: true })
  }

  reader.releaseLock()

  const match = banner.match(/listening on (\S+)/)
  if (!match) throw new Error(`host server did not report an address: ${banner}`)

  endpoint = `${match[1]}/__rsc/host-call`
})

afterAll(() => {
  server?.kill()
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

const call = (overrides: Partial<Parameters<typeof httpHostCalls>[0]> = {}) =>
  httpHostCalls({ endpoint, secret: SECRET, fetch: realFetch, ...overrides })

describe.skipIf(!hasGo)('a Go host answering rsc-kit host calls', () => {
  test('a component call reaches Go and the result comes back typed', async () => {
    const orders = (await call()('Orders.recent', 3)) as Array<{ id: number; total: number }>

    expect(orders).toHaveLength(3)
    expect(orders[0]).toEqual({ id: 1, total: 100 })
  })

  test('a call with no arguments uses the function default', async () => {
    expect((await call()('Orders.recent')) as unknown[]).toHaveLength(10)
  })

  // The point of the whole arrangement.
  test('the visitor session reaches Go, so the call runs as them', async () => {
    const session = await withRequest(
      { url: 'http://app.test/orders', headers: { cookie: 'laravel_session=xyz' } },
      () => call()('Me.session'),
    )

    expect(session).toBe('laravel_session=xyz')
  })

  test('outside a render there is no session to forward, and that is not an error', async () => {
    expect(await call()('Me.session')).toBe('')
  })

  test('what a Go function invalidated arrives on the JS side', async () => {
    const seen: string[][] = []

    const result = await call({ onRevalidate: (t) => seen.push(t) })('Orders.create', 'a hat')

    expect(result).toEqual({ created: 'a hat' })
    expect(seen).toEqual([['orders']])
  })

  test("a Go error becomes the render's error, with its message intact", async () => {
    await expect(call()('Orders.fail')).rejects.toThrow(/orders table is missing/)
  })

  test('a panic in Go is an error here, and the server is still up afterwards', async () => {
    await expect(call()('Orders.panic')).rejects.toThrow(/panicked.*nil map write/)

    // The next call proves the process survived, which is the actual claim.
    expect((await call()('Orders.recent', 1)) as unknown[]).toHaveLength(1)
  })

  test('an unknown name is rejected by Go, which is the side that knows', async () => {
    await expect(call()('Orders.recnt')).rejects.toThrow(/Orders.recnt/)
    await expect(call()('Orders.recnt')).rejects.toThrow(/Orders.recent/)
  })

  test('the wrong secret is refused', async () => {
    await expect(call({ secret: 'wrong' })('Orders.recent')).rejects.toThrow(/failed/)
  })

  test('concurrent calls do not cross answers', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => call()('Orders.recent', n) as Promise<unknown[]>),
    )

    expect(results.map((r) => r.length)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})
