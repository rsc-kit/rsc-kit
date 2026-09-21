/**
 * A page from the last build, talking to this one.
 *
 * Under a service worker the last build's document is served first, from the
 * cache, while the new worker installs behind it - so this is every returning
 * visitor's first navigation after a deploy, not an open tab. The old client's
 * manifest cannot load what the new payload names. The router's answer, in
 * both directions: load the document.
 */

import { registerDom } from './dom'

registerDom()

import { mock, afterEach, beforeEach, describe, expect, test } from 'bun:test'

// The worker's word that a newer build is live, under the test's control.
let updated = false

mock.module('../../src/js/updateStore', () => ({
  isUpdated: () => updated,
  subscribeToUpdates: () => () => {},
  updatedOnServer: () => false,
}))

const { navigate, setDeserializer, setNavigateHandler, setVersion } = await import('../../src/js/navigate')

let requests: { url: string; version: string | null }[] = []
let loaded: string[] = []
const realFetch = globalThis.fetch

/** A host on build B, answering 409 to a client that says it is another build. */
function installServer() {
  ;(globalThis as { fetch: unknown }).fetch = async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = new URL(String(input), 'https://example.test')
    const version = init?.headers?.['X-RSC-Version'] ?? null

    requests.push({ url: url.pathname + url.search, version })

    if (version && version !== 'build-b') {
      return new Response(null, {
        status: 409,
        headers: { 'X-RSC-Location': url.pathname + url.search, 'X-RSC-Version': 'build-b' },
      })
    }

    return new Response('page', {
      headers: { 'Content-Type': 'text/x-component', 'X-RSC-Segment-Depth': '0', 'X-RSC-Layouts': 'app/layout', 'X-RSC-Version': 'build-b' },
    })
  }
}

beforeEach(() => {
  requests = []
  loaded = []
  updated = false
  // The once-per-url guard remembers a load for ten seconds; each test is its own visitor.
  sessionStorage.clear()
  installServer()
  history.replaceState({}, '', '/')
  setDeserializer(async () => 'tree')
  setNavigateHandler(() => {})
  // What a document load is, here: the url the page is sent to. A plain
  // stand-in rather than a proxy over happy-dom's Location, whose private
  // fields a proxy cannot reach.
  const stand = {
    origin: 'https://example.test',
    protocol: 'https:',
    host: 'example.test',
    hostname: 'example.test',
    pathname: '/',
    search: '',
    hash: '',
    toString: () => 'https://example.test/',
  }

  Object.defineProperty(window, 'location', {
    configurable: true,
    value: Object.defineProperty(stand, 'href', {
      get: () => 'https://example.test/',
      set: (value: string) => {
        loaded.push(value)
      },
    }),
  })
})

afterEach(() => {
  ;(globalThis as { fetch: unknown }).fetch = realFetch
  setVersion('')
})

describe('a client of the last build', () => {
  test('is sent to load the document by the host, and goes', async () => {
    // Seeded from the document, which is build A's.
    setVersion('build-a')

    await navigate('/login?next=%2Fagent' as never).catch(() => {})

    expect(requests).toEqual([{ url: '/login?next=%2Fagent', version: 'build-a' }])
    expect(loaded).toEqual(['/login?next=%2Fagent'])
  })

  test('tells the worker which build the server is on before it loads the document, and waits to be heard', async () => {
    // The worker serves a stored document from its cache, and its cache is
    // the build this page came from. Told, it serves the network for a copy
    // from any other build - so the load lands on the current one, once,
    // rather than on the old one again and again, once per url.
    setVersion('build-a')

    const told: unknown[] = []
    let updated = 0
    const order: string[] = []

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: {
          postMessage(message: unknown, transfer: MessagePort[]) {
            told.push(message)
            order.push('told')
            // Answered on the port, as the worker does.
            transfer[0].postMessage({ type: 'rsc-kit:server-build', version: 'build-b' })
          },
        },
        getRegistration: async () => ({ update: async () => { updated++ } }),
      },
    })

    // The stand-in location from beforeEach records loads; the order of
    // the two is what matters here.
    const recorded = loaded
    const seen = () => recorded.length

    try {
      const before = seen()

      await navigate('/login' as never).catch(() => {})
      await new Promise((r) => setTimeout(r, 10))

      expect(told).toEqual([{ type: 'rsc-kit:server-build', version: 'build-b' }])
      expect(order).toEqual(['told'])
      expect(recorded.slice(before)).toEqual(['/login'])
      expect(updated).toBe(1)
    } finally {
      delete (navigator as { serviceWorker?: unknown }).serviceWorker
    }
  })

  test('once the worker has announced a newer build, navigates by document without asking', async () => {
    setVersion('build-a')
    updated = true

    await navigate('/login' as never)

    expect(requests).toEqual([])
    expect(loaded).toEqual(['/login'])
  })

  test('the same build is answered with the payload', async () => {
    setVersion('build-b')

    await navigate('/login' as never)

    expect(requests).toEqual([{ url: '/login', version: 'build-b' }])
    expect(loaded).toEqual([])
  })
})
