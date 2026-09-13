// Repeated reads reach the server, which is what makes polling possible.
//
// This decides whether `query.live` has to exist. If a read can simply be
// repeated — by a cache library's refetchInterval, or by anything else — then
// data that changes while someone watches already has an answer, and a
// streaming primitive only earns its place where polling is genuinely wasteful
// rather than merely where data moves.
//
// The transport's half is asserted here. Whether TanStack's timer fires is
// TanStack's business, and testing it under act() measures the test harness.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { claimRead, clearQueries, fetchQuery, readQuery, setQueryCodec } from '../../src/js/queryClient'

const seats = ((...args: unknown[]) => claimRead('m#seats', args)!) as never as (
  ...a: never[]
) => Promise<string>

let reads = 0
let priorFetch: typeof fetch
let priorWindow: PropertyDescriptor | undefined

beforeEach(() => {
  reads = 0
  clearQueries()

  setQueryCodec({
    encode: async (a) => JSON.stringify(a),
    deserialize: async (stream) => {
      const url = await new Response(stream).text()
      const q = new URL(url, 'https://x.test').searchParams.get('q') ?? '[]'

      // A different answer each time, the way a seat count would be.
      return { results: (JSON.parse(q) as unknown[]).map(() => `seats-${reads}`) }
    },
  })

  priorFetch = globalThis.fetch
  globalThis.fetch = (async (i: RequestInfo | URL) => {
    reads += 1

    return new Response(String(i))
  }) as typeof fetch

  priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    value: { location: { pathname: '/seats', search: '' } },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  globalThis.fetch = priorFetch

  if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
  else delete (globalThis as { window?: unknown }).window
})

describe('repeating a read', () => {
  test('fetchQuery goes to the server every time, and the answer moves', async () => {
    const first = await fetchQuery(seats, [])
    const second = await fetchQuery(seats, [])
    const third = await fetchQuery(seats, [])

    expect(reads).toBe(3)
    expect(new Set([first, second, third]).size).toBe(3)
  })

  test('concurrent repeats still coalesce', async () => {
    // Polling must not multiply into a request per caller. Two components
    // watching the same value at the same moment are one read.
    const [a, b] = await Promise.all([fetchQuery(seats, []), fetchQuery(seats, [])])

    expect(reads).toBe(1)
    expect(a).toBe(b)
  })

  test('readQuery cannot poll, by design', async () => {
    // Stated as a test because it is the trap: readQuery is for use() during
    // render and hands back the same answer forever, so a poll built on it
    // shows the first value for the life of the page.
    const first = await readQuery(seats, [])
    const second = await readQuery(seats, [])

    expect(reads).toBe(1)
    expect(second).toBe(first)
  })
})
