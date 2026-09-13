// Reads over GET: what may be invoked, how it travels, and who may trigger it.
//
// The client half runs against fake references rather than a real bundle. That
// is not a shortcut — what is being tested is that a read claims the slot React
// opens when it hands over an id, and a fake reference reproduces that exactly:
// its whole body is `callServer(id, args)`, which is all a real stub's body is.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { isQuery, query, queryCacheControl } from '../../src/query'
import { claimRead, fetchQuery, setQueryCodec } from '../../src/js/queryClient'
import { createRscHandler } from '../../src/host'
import { HEADER } from '../../src/headers'
import type { RouteManifest } from '../../src/manifest'

describe('declaring a read', () => {
  test('a query is marked and a bare function is not', () => {
    expect(isQuery(query(async () => 'ok'))).toBe(true)
    expect(isQuery(async () => 'ok')).toBe(false)
    expect(isQuery(null)).toBe(false)
  })

  test('the mark survives a second copy of the module', () => {
    // The seam this exists for: an app's server functions are bundled apart
    // from the engine, so each side evaluates its own copy of query.ts. A
    // WeakSet or an instanceof check is empty across that seam and every query
    // would answer "not a query" with nothing logged. Symbol.for is registry-
    // wide, which is what this builds by hand.
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
  })
})

// A stand-in for what @vitejs/plugin-rsc gives a client component: a function
// whose body calls callServer with the id React kept private.
function reference(id: string) {
  const stub = (...args: unknown[]) => {
    const claimed = claimRead(id, args)

    // A real stub posts when nothing claimed the call. Recorded rather than
    // performed, so a test can assert a read never took that path.
    if (!claimed) {
      posted.push(id)

      return Promise.resolve('POSTED')
    }

    return claimed
  }

  return stub as unknown as (...args: never[]) => Promise<unknown>
}

let posted: string[] = []
let sent: { url: string; headers: Record<string, string> }[] = []
let priorFetch: typeof fetch
let priorWindow: PropertyDescriptor | undefined
let encodeAs: (args: unknown[]) => Promise<string | FormData> = async (a) => JSON.stringify(a)

beforeEach(() => {
  posted = []
  sent = []
  encodeAs = async (a) => JSON.stringify(a)

  setQueryCodec({
    encode: (args) => encodeAs(args),
    deserialize: async (stream) => `answered:${await new Response(stream).text()}`,
    asAction: async (id) => {
      posted.push(id)

      return 'POSTED'
    },
  })

  priorFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    })

    return new Response('body')
  }) as typeof fetch

  // Saved and put back: every test file here shares one process, so a `window`
  // left behind is one the DOM tests get instead of happy-dom's.
  priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    value: { location: { pathname: '/listings', search: '?a=1' } },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  globalThis.fetch = priorFetch

  if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
  else delete (globalThis as { window?: unknown }).window
})

describe('sending a read', () => {
  test('goes out as a GET, never a POST', async () => {
    const getListings = reference('m#getListings')

    await fetchQuery(getListings, [{ city: 'Kingston' }])

    expect(posted).toEqual([])
    expect(sent).toHaveLength(1)
    expect(sent[0].url.startsWith('/_rsc/query?id=')).toBe(true)
  })

  test('carries the header the endpoint requires', async () => {
    await fetchQuery(reference('m#getListings'), [])

    // Without it a GET is a simple request, so any page could trigger the read
    // with an <img> and the visitor's cookies.
    expect(sent[0].headers['X-RSC-Query']).toBe('1')
  })

  test('every call reaches the server', async () => {
    const getListings = reference('m#getListings')

    await fetchQuery(getListings, [])
    await fetchQuery(getListings, [])

    // No cache here on purpose. A cache library decides whether to ask again,
    // and one that could not actually re-read would have its revalidation
    // silently do nothing.
    expect(sent).toHaveLength(2)
  })

  test('falls back to a POST when the arguments cannot ride in a url', async () => {
    encodeAs = async () => new FormData()

    const upload = reference('m#withFile')

    // A File cannot go in a url. Refusing would break a call that works fine as
    // an action, so the read still happens — it just stops being cacheable.
    expect(await fetchQuery(upload, [])).toBe('POSTED')
    expect(sent).toHaveLength(0)
    expect(posted).toEqual(['m#withFile'])
  })

  test('falls back to a POST when the url would be too long', async () => {
    encodeAs = async () => 'x'.repeat(7_000)

    expect(await fetchQuery(reference('m#big'), [])).toBe('POSTED')
    expect(posted).toEqual(['m#big'])
  })

  test('a bound reference is refused rather than quietly posted', async () => {
    const bound = (() => Promise.resolve('never claimed')) as never as (
      ...a: never[]
    ) => Promise<unknown>

    expect(() => fetchQuery(bound, [])).toThrow('bound reference')
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

const answering = async () => ({
  stream: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
  cacheControl: 'private, no-store',
})

describe('the endpoint', () => {
  const get = (search: string, headers: Record<string, string> = { [HEADER.query]: '1' }) =>
    new Request(`https://app.test/_rsc/query${search}`, { headers })

  test('answers a read and passes its cache-control through', async () => {
    let seen: unknown = null

    const handle = hostWith(async (id: string, args: string) => {
      seen = { id, args }

      return await answering()
    })

    const res = await handle(get('?id=m%23one&args=%5B%5D'))

    expect(res?.status).toBe(200)
    expect(seen).toEqual({ id: 'm#one', args: '[]' })
    expect(res?.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res?.headers.get('Vary')).toContain('Cookie')
  })

  test('refuses a read with no X-RSC-Query header', async () => {
    let ran = false

    const handle = hostWith(async () => {
      ran = true

      return await answering()
    })

    // This is the CSRF guard. An <img src> can send the url but not the header,
    // and a browser preflights the header rather than sending it blind.
    const res = await handle(get('?id=m%23one&args=%5B%5D', {}))

    expect(res?.status).toBe(400)
    expect(ran).toBe(false)
  })

  test('answers 404 for an id that is not a query', async () => {
    // The engine returns null for both "no such id" and "registered, but an
    // action". Saying which would tell whoever is probing this endpoint what
    // the real action ids are, and ids are stable for a build.
    const handle = hostWith(async () => null)

    expect((await handle(get('?id=m%23mutate&args=%5B%5D')))?.status).toBe(404)
  })

  test('refuses a missing id or args', async () => {
    const handle = hostWith(answering)

    expect((await handle(get('?args=%5B%5D')))?.status).toBe(400)
    expect((await handle(get('?id=m%23one')))?.status).toBe(400)
  })

  test('refuses an oversized url before anything decodes it', async () => {
    let ran = false

    const handle = hostWith(async () => {
      ran = true

      return await answering()
    })

    const res = await handle(get(`?id=m%23one&args=${'x'.repeat(9_000)}`))

    expect(res?.status).toBe(414)
    expect(ran).toBe(false)
  })

  test('a bundle built before queries existed falls through instead of throwing', async () => {
    // Null is "not mine" — the host in front serves its 404. A throw here would
    // turn an old bundle into a 500 on a url its own client never calls.
    expect(await hostWith(undefined)(get('?id=m%23one&args=%5B%5D'))).toBeNull()
  })
})
