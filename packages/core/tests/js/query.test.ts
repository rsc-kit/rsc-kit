// Reads over GET: what may be invoked, how many requests it costs, and how a
// batch is allowed to be stored.
//
// The client half runs against fake references rather than a real bundle. That
// is not a shortcut — the thing being tested is that a read claims the slot
// React opens when it hands over an id, and a fake reference reproduces that
// exactly: its whole body is `callServer(id, args)`, which is all a real stub's
// body is either.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  isQuery,
  narrowestCacheControl,
  query,
  queryCacheControl,
  queryError,
  isQueryError,
} from '../../src/query'
import {
  claimRead,
  clearQueries,
  invalidateQuery,
  readQuery,
  setQueryCodec,
} from '../../src/js/queryClient'
import { createRscHandler } from '../../src/host'
import type { RouteManifest } from '../../src/manifest'

describe('declaring a read', () => {
  test('a query is marked and a bare function is not', () => {
    const read = query(async () => 'ok')

    expect(isQuery(read)).toBe(true)
    expect(isQuery(async () => 'ok')).toBe(false)
    expect(isQuery(null)).toBe(false)
  })

  test('the mark survives a second copy of the module', () => {
    // The seam this exists for: an app's server functions are bundled apart
    // from the engine, so each side evaluates its own copy of query.ts. A
    // WeakSet or an instanceof check is empty across that seam and every query
    // would answer "not a query" with nothing logged. Symbol.for is registry-
    // wide, so a mark applied by one copy is read by the other — which is what
    // this builds by hand, since a second copy is a second bundle.
    const marked = async () => 'ok'

    Object.defineProperty(marked, Symbol.for('@rsc-kit/core.query'), { value: true })

    expect(isQuery(marked)).toBe(true)
  })

  test('the default is the one that cannot leak', () => {
    expect(queryCacheControl(query(async () => 1))).toBe('private, no-store')
  })

  test('a query may widen, per query', () => {
    expect(queryCacheControl(query(async () => 1, { cache: 'public', maxAge: 60 }))).toBe(
      'public, max-age=60',
    )
    expect(queryCacheControl(query(async () => 1, { cache: 'private' }))).toBe(
      'private, max-age=0, must-revalidate',
    )
  })
})

describe('how narrowly a batch may be stored', () => {
  test('one no-store read makes the whole answer no-store', () => {
    expect(
      narrowestCacheControl(['public, max-age=60', 'private, no-store', 'public, max-age=60']),
    ).toBe('private, no-store')
  })

  test('a private read keeps a public one out of a shared cache', () => {
    expect(narrowestCacheControl(['public, max-age=60', 'private, max-age=0, must-revalidate'])).toBe(
      'private, max-age=0, must-revalidate',
    )
  })

  test('an empty batch is not an invitation to store anything', () => {
    expect(narrowestCacheControl([])).toBe('private, no-store')
  })
})

// A stand-in for what @vitejs/plugin-rsc gives a client component: a function
// whose body calls callServer with the id React kept private.
function reference(id: string) {
  const stub = (...args: unknown[]) => {
    const claimed = claimRead(id, args)

    // A real stub posts when nothing claimed the call. Recorded rather than
    // performed, so a test can assert that a read never took that path.
    if (!claimed) {
      posted.push(id)

      return Promise.resolve('POSTED')
    }

    return claimed
  }

  return stub as unknown as (...args: never[]) => Promise<unknown>
}

let posted: string[] = []
let fetched: string[] = []
let priorWindow: PropertyDescriptor | undefined
let priorFetch: typeof fetch

/**
 * What the server answers, as a function of the batch it actually received.
 *
 * Deliberately not a fixed list: the transport sorts a batch for a stable url,
 * so a fake that answers positionally without reading the request would agree
 * with a transport that paired results back to the wrong reads.
 */
let answer: (entries: [string, string][]) => unknown[] = (entries) =>
  entries.map(([id]) => `answer-to-${id.split('#')[1]}`)

/** The batch a query url is carrying, read back the way the server reads it. */
function batchOf(url: string): [string, string][] {
  const q = new URL(url, 'https://app.test').searchParams.get('q') ?? '[]'

  return JSON.parse(q) as [string, string][]
}

beforeEach(() => {
  posted = []
  fetched = []
  clearQueries()
  answer = (entries) => entries.map(([id]) => `answer-to-${id.split('#')[1]}`)

  setQueryCodec({
    // Deterministic: the real encoder produces React's reply format, which
    // nothing here needs to parse.
    encode: async (args) => JSON.stringify(args),
    deserialize: async (stream) => {
      const url = await new Response(stream).text()

      return { results: answer(batchOf(url)) }
    },
  })

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)

    fetched.push(url)

    return new Response(url, { headers: { 'Content-Type': 'text/x-component' } })
  }) as typeof fetch

  // Saved and put back afterwards. Every test file in this suite shares one
  // process, so a `window` left behind here is a `window` the DOM tests get
  // instead of happy-dom's — and they fail a long way from the cause.
  priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  priorFetch = globalThis.fetch

  Object.defineProperty(globalThis, 'window', {
    value: { location: { pathname: '/listings', search: '?a=1' } },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
  else delete (globalThis as { window?: unknown }).window

  globalThis.fetch = priorFetch
})

describe('reading', () => {
  test('a read goes out as a GET and never as a POST', async () => {
    const getListings = reference('listings#getListings')

    expect(await readQuery(getListings, [{ city: 'Kingston' }])).toBe('answer-to-getListings')
    expect(posted).toEqual([])
    expect(fetched).toHaveLength(1)
    expect(fetched[0].startsWith('/_rsc/query?q=')).toBe(true)
  })

  test('the same read twice is one request and one promise', async () => {
    const getListings = reference('listings#getListings')

    const first = readQuery(getListings, [{ city: 'Kingston' }])
    const second = readQuery(getListings, [{ city: 'Kingston' }])

    // Identity, not just equality. `use()` suspends on the promise it is
    // given, so handing out a second one for the same read is what makes a
    // re-render refetch and flash its fallback.
    expect(first).toBe(second)

    await first

    expect(fetched).toHaveLength(1)
  })

  test('the cache outlives the request, so a later render does not refetch', async () => {
    const getListings = reference('listings#getListings')

    await readQuery(getListings, [])

    // The re-render, after everything has settled. A time-based cache would
    // have expired by now on a slow page and suspended again.
    const later = readQuery(getListings, [])

    expect(await later).toBe('answer-to-getListings')
    expect(fetched).toHaveLength(1)
  })

  test('argument order is not part of the key', async () => {
    const getListings = reference('listings#getListings')

    const first = readQuery(getListings, [{ city: 'Kingston', type: 'stay' }])
    const second = readQuery(getListings, [{ type: 'stay', city: 'Kingston' }])

    expect(first).toBe(second)

    await first

    expect(fetched).toHaveLength(1)
  })

  test('different arguments are different reads', async () => {
    const getListings = reference('listings#getListings')

    const both = Promise.all([
      readQuery(getListings, [{ city: 'Kingston' }]),
      readQuery(getListings, [{ city: 'Ocho Rios' }]),
    ])

    await both

    expect(fetched).toHaveLength(1)
  })

  test('invalidating makes the next read ask again', async () => {
    const getListings = reference('listings#getListings')

    await readQuery(getListings, [])
    invalidateQuery(getListings)
    await readQuery(getListings, [])

    expect(fetched).toHaveLength(2)
  })

  test('a failure is not remembered as an answer', async () => {
    answer = () => [queryError('boom')]

    const getListings = reference('listings#getListings')

    await expect(readQuery(getListings, [])).rejects.toThrow('boom')

    answer = (entries) => entries.map(([id]) => `answer-to-${id.split('#')[1]}`)

    // The retry must actually retry. A rejection left in the cache would be
    // handed straight back, so a dropped connection would look permanent.
    expect(await readQuery(getListings, [])).toBe('answer-to-getListings')
    expect(fetched).toHaveLength(2)
  })
})

describe('batching', () => {
  test('reads in the same tick are one request', async () => {
    const one = reference('m#one')
    const two = reference('m#two')
    const three = reference('m#three')

    const all = await Promise.all([readQuery(one, []), readQuery(two, []), readQuery(three, [])])

    // Each read gets its own answer, not the one that happened to sit at its
    // index: the batch goes out sorted, so `two` is sent last.
    expect(all).toEqual(['answer-to-one', 'answer-to-two', 'answer-to-three'])
    expect(fetched).toHaveLength(1)
  })

  test('the url does not depend on the order the components rendered in', async () => {
    const one = reference('m#one')
    const two = reference('m#two')

    await Promise.all([readQuery(one, []), readQuery(two, [])])

    const forwards = fetched[0]

    clearQueries()
    fetched = []

    await Promise.all([readQuery(two, []), readQuery(one, [])])

    // A batch url that varies by render order is a cache entry that is never
    // hit twice — which would quietly undo the reason these are GETs at all.
    expect(fetched[0]).toBe(forwards)
  })

  test('results come back matched to the reads that asked for them', async () => {
    // Requested zulu-first, but the batch goes out sorted, so pairing answers
    // back by request position would hand each component the other's data.
    const zulu = reference('m#zulu')
    const alpha = reference('m#alpha')

    const [z, a] = await Promise.all([readQuery(zulu, []), readQuery(alpha, [])])

    expect(a).toBe('answer-to-alpha')
    expect(z).toBe('answer-to-zulu')
  })

  test('reads in separate ticks are separate requests', async () => {
    const one = reference('m#one')
    const two = reference('m#two')

    await readQuery(one, [])
    await readQuery(two, [])

    expect(fetched).toHaveLength(2)
  })

  test('a batch too large for one url is split rather than truncated', async () => {
    const big = 'y'.repeat(2_000)
    const reads = ['a', 'b', 'c', 'd'].map((name) => reference(`m#${name}`))

    await Promise.all(reads.map((read) => readQuery(read, [big])))

    // The point is that every read is sent. A batch silently trimmed to fit
    // leaves a component loading forever with nothing reported.
    expect(fetched.length).toBeGreaterThan(1)
    expect(fetched.every((url) => url.length <= 6_200)).toBe(true)
  })
})

function manifest(): RouteManifest {
  return {
    version: 1,
    build: { output: 'server', exportPath: 'dist', payloadName: '' },
    routes: [
      {
        component: 'app/page',
        segments: [],
        layouts: [],
        loadings: [],
        middleware: [],
        slots: {},
        sections: [],
        config: null,
        ancestorConfigs: [],
        staticParams: false,
        clientJs: true,
      },
    ],
    intercepts: [],
  }
}

function hostWith(handleQuery?: unknown) {
  const empty = () => new ReadableStream({ start: (c) => c.close() })

  return createRscHandler({
    manifest: manifest(),
    engine: {
      installHostFn() {},
      async handleRscStream() {
        return { stream: empty(), segmentDepth: 0 }
      },
      async handleRscHtmlStream() {
        return { htmlStream: empty() }
      },
      async handleAction() {
        return { stream: empty() }
      },
      ...(handleQuery ? { handleQuery } : {}),
    } as never,
  })
}

describe('the endpoint', () => {
  const get = (search: string) => new Request(`https://app.test/_rsc/query${search}`)

  test('a batch reaches the engine and its cache-control is what goes out', async () => {
    let seen: unknown = null

    const handle = hostWith(async (batch: unknown) => {
      seen = batch

      return {
        stream: new ReadableStream({ start: (c) => c.close() }),
        cacheControl: 'private, no-store',
      }
    })

    const q = encodeURIComponent(JSON.stringify([['m#one', '[]']]))
    const res = await handle(get(`?q=${q}`))

    expect(res?.status).toBe(200)
    expect(seen).toEqual([{ id: 'm#one', args: '[]' }])
    expect(res?.headers.get('Cache-Control')).toBe('private, no-store')
  })

  test('the answer varies on the cookie', async () => {
    const handle = hostWith(async () => ({
      stream: new ReadableStream({ start: (c) => c.close() }),
      cacheControl: 'private, max-age=0, must-revalidate',
    }))

    const q = encodeURIComponent(JSON.stringify([['m#one', '[]']]))
    const res = await handle(get(`?q=${q}`))

    // A query that reads the session answers differently per visitor, and the
    // request that carries who they are is the cookie. Without this, a shared
    // cache keyed on the url hands one visitor another's answer.
    expect(res?.headers.get('Vary')).toContain('Cookie')
  })

  test('a malformed batch is refused rather than decoded', async () => {
    const handle = hostWith(async () => ({
      stream: new ReadableStream({ start: (c) => c.close() }),
      cacheControl: 'private, no-store',
    }))

    expect((await handle(get('?q=not-json')))?.status).toBe(400)
    expect((await handle(get(`?q=${encodeURIComponent('{}')}`)))?.status).toBe(400)
    expect((await handle(get(`?q=${encodeURIComponent('[]')}`)))?.status).toBe(400)
    expect((await handle(get(`?q=${encodeURIComponent('[[1,2]]')}`)))?.status).toBe(400)
    expect((await handle(get('')))?.status).toBe(400)
  })

  test('an oversized batch is refused before anything decodes it', async () => {
    let ran = false

    const handle = hostWith(async () => {
      ran = true

      return {
        stream: new ReadableStream({ start: (c) => c.close() }),
        cacheControl: 'private, no-store',
      }
    })

    const res = await handle(get(`?q=${'x'.repeat(9_000)}`))

    expect(res?.status).toBe(414)
    expect(ran).toBe(false)
  })

  test('a cross-origin read is refused', async () => {
    const handle = hostWith(async () => ({
      stream: new ReadableStream({ start: (c) => c.close() }),
      cacheControl: 'private, no-store',
    }))

    const q = encodeURIComponent(JSON.stringify([['m#one', '[]']]))
    const request = new Request(`https://app.test/_rsc/query?q=${q}`)

    // The headers are substituted rather than passed to the constructor.
    // Origin is a forbidden header name, so a spec-compliant Request drops it
    // — and two other files in this suite register happy-dom globally, whose
    // Request does exactly that. Setting it the obvious way makes this pass or
    // fail on which file ran first, which is not a test of anything.
    Object.defineProperty(request, 'headers', {
      value: {
        get: (name: string) => (name.toLowerCase() === 'origin' ? 'https://evil.test' : null),
      },
      configurable: true,
    })

    expect((await handle(request))?.status).toBe(403)
  })

  test('a bundle built before queries existed falls through instead of throwing', async () => {
    const handle = hostWith(undefined)
    const q = encodeURIComponent(JSON.stringify([['m#one', '[]']]))

    // Null is "not mine" — the host in front serves its 404. A throw here
    // would turn an old bundle into a 500 on a url its own client never calls.
    expect(await handle(get(`?q=${q}`))).toBeNull()
  })
})

describe('a failure crossing the boundary', () => {
  test('is recognised whichever copy of the module built it', () => {
    expect(isQueryError(queryError('nope'))).toBe(true)
    expect(isQueryError({ message: 'nope' })).toBe(false)
    expect(isQueryError(null)).toBe(false)
  })
})
