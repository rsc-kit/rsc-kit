// What the offline worker is allowed to keep.
//
// The worker files responses by url, and the Cache API has no notion of who
// asked. So anything narrowed by the visitor — a query reading the session, a
// guarded page — must not be stored, or the next person to open the app is
// served the last person's answer. `Cache-Control: no-store` is how the server
// says so, and honouring it is not optional.
//
// Tested against the generated source rather than by running a worker: there is
// no ServiceWorkerGlobalScope here, and what actually goes wrong is a
// `cache.put` added later that forgets to ask.

import { describe, expect, test } from 'bun:test'
import { SERVICE_WORKER, workerVersion } from '../../src/vite'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const source = SERVICE_WORKER('abc123abc123', ['/', '/assets/app.js'])

/** The predicate, lifted out of the generated worker and made callable. */
const mayStore = new Function(
  'response',
  `const fn = ${source.match(/const mayStore = ([\s\S]*?)\n\n/)![1]}; return fn(response)`,
) as (response: { ok: boolean; headers: Headers }) => boolean

const answer = (ok: boolean, cacheControl?: string) => ({
  ok,
  headers: new Headers(cacheControl ? { 'Cache-Control': cacheControl } : {}),
})

describe('what the worker may keep', () => {
  test('an ordinary page, yes', () => {
    expect(mayStore(answer(true, 'public, max-age=0, must-revalidate'))).toBe(true)
    expect(mayStore(answer(true))).toBe(true)
  })

  test('a failure, no', () => {
    expect(mayStore(answer(false, 'public, max-age=60'))).toBe(false)
  })

  test('anything the server marked no-store, no', () => {
    // A query defaults to exactly this, because it may read the session.
    expect(mayStore(answer(true, 'private, no-store'))).toBe(false)
    expect(mayStore(answer(true, 'no-store'))).toBe(false)
  })

  test('a private answer that is not no-store is still the visitor’s own', () => {
    // `private` means "not a shared cache". This worker IS the visitor's own
    // browser, so it may keep it — that is the difference the query guide
    // draws between `private` and `no-store`.
    expect(mayStore(answer(true, 'private, max-age=0, must-revalidate'))).toBe(true)
  })
})

describe('the generated worker', () => {
  test('never stores a response without asking first', () => {
    // The guard that matters is the one a future edit forgets. Every put has to
    // sit behind mayStore; a bare `response.ok` check reaching a cache.put is
    // how a personal answer ends up on disk.
    const puts = source.match(/cache\.put\(/g) ?? []

    expect(puts.length).toBeGreaterThan(0)
    expect(source).toContain('const mayStore =')
    expect(source).not.toMatch(/if \(response\.ok\) \{\s*const copy/)
  })
})

describe('which urls the worker trusts its cache for', () => {
  const withFrozen = SERVICE_WORKER('abc123abc123', ['/'], ['/', '/orders', '/posts/hello'])

  /** The membership test, lifted out and made callable. */
  const isFrozen = (pathname: string, search = '') =>
    new Function(
      'pathname',
      'search',
      `const FROZEN = new Set(${JSON.stringify(['/', '/orders', '/posts/hello'])});
       const url = { pathname, search };
       return FROZEN.has(url.pathname.replace(/\\/+$/, '') || '/') && !url.search`,
    )(pathname, search) as boolean

  test('the list the build stored is in the worker', () => {
    expect(withFrozen).toContain('const FROZEN = new Set(["/","/orders","/posts/hello"])')
  })

  test('a stored page is served from cache first', () => {
    expect(isFrozen('/orders')).toBe(true)
  })

  test('with or without a trailing slash, since a link may carry one', () => {
    expect(isFrozen('/orders/')).toBe(true)
    expect(isFrozen('/')).toBe(true)
  })

  test('but never with a query string', () => {
    // The build answered the bare url. A page reading ?q= answers differently
    // for every value, and the cache is keyed by url.
    expect(isFrozen('/orders', '?q=shoes')).toBe(false)
  })

  test('and never a url the build did not store', () => {
    // Everything else stays network-first. A page that reads the request has a
    // right answer that depends on the request.
    expect(isFrozen('/dashboard')).toBe(false)
  })

  test('an app with nothing frozen still produces a working worker', () => {
    expect(SERVICE_WORKER('abc123abc123', ['/'])).toContain('const FROZEN = new Set([])')
  })
})

describe('the page shown when nothing can answer', () => {
  const withFallback = SERVICE_WORKER('abc123abc123', ['/'], ['/', '/offline'], '/offline')

  test('is precached, because the moment it is needed is the moment it cannot be fetched', () => {
    expect(withFallback).toContain('const OFFLINE_URL = "/offline"')
    expect(withFallback).toContain('[...PRECACHE, OFFLINE_URL]')
  })

  test('is served for navigations only', () => {
    // A payload request answered with a document would be handed to the Flight
    // decoder, which throws — so the page would break rather than say it is
    // offline.
    expect(withFallback).toContain("if (request.mode === 'navigate') return (await own(OFFLINE_URL)) ?? null")
  })

  test('and an app without one behaves exactly as before', () => {
    const none = SERVICE_WORKER('abc123abc123', ['/'], ['/'])

    expect(none).toContain('const OFFLINE_URL = null')
    // No fallback means the old answer: fail, rather than serve the cached root
    // under someone else's url.
    expect(none).toContain('return Response.error()')
  })
})

describe('telling an open page a new build is live', () => {
  const source = SERVICE_WORKER('abc123abc123', ['/'])

  test('the worker says so after it sweeps, not before', () => {
    // A page acting on it immediately should reload into the new version
    // rather than race the deletion of the old one.
    const sweep = source.indexOf('caches.delete')
    const tell = source.indexOf('tellTheOpenPages()')

    expect(sweep).toBeGreaterThan(-1)
    expect(tell).toBeGreaterThan(sweep)
  })

  test('to every open window, with the version', () => {
    expect(source).toContain("matchAll({ type: 'window' })")
    expect(source).toContain("type: 'rsc-kit:updated'")
  })
})

describe("the app's own worker code", () => {
  test('is imported first, so its listeners are registered before ours', () => {
    // An app handler for an event this file also answers must be registered
    // before anything here can call respondWith on it.
    const source = SERVICE_WORKER('abc123abc123', ['/'], [], null, '/sw-app.js')
    const imported = source.indexOf('self.importScripts("/sw-app.js")')
    const ourFirstListener = source.indexOf("addEventListener('install'")

    expect(imported).toBeGreaterThan(-1)
    expect(imported).toBeLessThan(ourFirstListener)
  })

  test('and an app without one has no import at all', () => {
    // Not an empty importScripts of a file that is not there — that throws, and
    // a worker whose evaluation throws never starts.
    expect(SERVICE_WORKER('abc123abc123', ['/'])).not.toContain('importScripts')
  })
})

describe('what a port found offline', () => {
  const source = SERVICE_WORKER('abc123abc123', ['/', '/assets/index-abc12345.js'], ['/', '/pricing'], '/offline')

  test('a frozen page never visited falls back to the offline page, not ERR_FAILED', () => {
    // The frozen branch is cache-first with the network behind it; with
    // neither, it threw where every other navigation showed /offline.
    const frozenBranch = source.slice(source.indexOf('FROZEN.has('), source.indexOf('event.respondWith(\n    fetch(request)'))

    expect(frozenBranch).toContain('standIn(request)')
  })

  test('a precached page has its boot payload precached too, so it hydrates offline', () => {
    // The document alone is markup that never hydrates: the client fetches
    // its payload on boot, and nothing cached answered it.
    const install = source.slice(source.indexOf("addEventListener('install'"), source.indexOf("addEventListener('activate'"))

    expect(install).toContain("headers: { 'X-RSC': '1' }")
    expect(install).toContain('cache.put(keyFor(warm), payload)')
    // Pages, not assets: a payload for /assets/x.js is nothing.
    expect(install).toContain('PRECACHE.filter(')
    expect(install).toContain('OFFLINE_URL ? [OFFLINE_URL] : []')
  })

  test('the precache is what boots the app, not everything in public/', async () => {
    const { bootsTheApp } = await import('../../src/vite')

    for (const file of ['assets/index-abc.js', 'assets/index-abc.css', 'assets/inter-latin.woff2', 'manifest.webmanifest', 'icon-192.png', 'apple-icon.png', 'favicon.ico']) {
      expect([file, bootsTheApp(file)]).toEqual([file, true])
    }

    // A megabyte before the first page: a webp encoder, the share card, a
    // photo. Cached the first time they are used instead.
    for (const file of ['assets/encoder-abc.wasm', 'opengraph-image.png', 'twitter-image.png', 'assets/hero-abc.webp', 'assets/photo.jpg', 'assets/codec.wasm.js']) {
      expect([file, bootsTheApp(file)]).toEqual([file, false])
    }
  })
})

describe('what a second port found offline', () => {
  const source = SERVICE_WORKER('abc123abc123', ['/'], ['/'], '/offline')

  test('a boot payload that cannot be stored is said, not swallowed', () => {
    expect(source).toContain('was not stored')
    expect(source).toContain('will not hydrate offline')
  })

  test('an update is announced only when an older cache was swept', () => {
    // The first worker a visitor ever gets activates too, and announced a new
    // version on their second page with nothing to be new against.
    const activate = source.slice(source.indexOf("addEventListener('activate'"), source.indexOf('async function tellTheOpenPages'))

    expect(activate).toContain('older.length > 0')
    expect(activate).toContain('swept ? tellTheOpenPages() : undefined')
  })
})

describe('what a third pass found offline', () => {
  const source = SERVICE_WORKER('abc123abc123', ['/'], ['/'], '/offline')

  test('a payload is warmed with the header the client boots with, and matched ignoring Vary', () => {
    // A stored payload varies on X-RSC. Warmed as "true" and asked for as
    // "1", the Cache API said miss with the entry right there; the key
    // already carries what Vary is for.
    expect(source).not.toContain("'X-RSC': 'true'")
    expect(source).toContain("headers: { 'X-RSC': '1' }")
    expect(source).toContain('const MATCH = { ignoreVary: true }')
    expect(source).toContain('own(keyFor(request), MATCH)')
  })
})

describe('the offline page standing in for another url', () => {
  test('answers that url\'s boot payload with its own, so the fallback hydrates', () => {
    // The runtime boots the page in the address bar and asks for its
    // payload - the one thing nothing has. The offline page's payload is
    // what the document on screen is. A boot only: a navigation while
    // offline keeps failing as itself, and the open page keeps its banner.
    const source = SERVICE_WORKER('abc123abc123', ['/'], ['/', '/terms'], '/offline')
    const standIn = source.slice(source.indexOf('const standIn'), source.indexOf('const MATCH'))

    expect(standIn).toContain("request.headers.get('X-RSC') && !request.headers.get('X-RSC-Segments')")
    expect(standIn).toContain("new URL(OFFLINE_URL, self.location.origin), { headers: { 'X-RSC': '1' } }")

    // Both branches: the frozen one - a page the build stored that this
    // browser never visited - and the network-first one. The first fix
    // reached only the second, and /terms stood inert where /agent/x hydrated.
    const frozenBranch = source.slice(source.indexOf('FROZEN.has('), source.indexOf('event.respondWith(\n    fetch(request)'))
    const networkBranch = source.slice(source.indexOf('event.respondWith(\n    fetch(request)'))

    expect(frozenBranch).toContain('standIn(request)')
    expect(networkBranch).toContain('standIn(request)')
  })
})

describe('a stored document that may be the previous build\'s', () => {
  // A deploy is how a page that "cannot have changed" changes. The old
  // worker went on serving the old document from its cache while the new
  // one installed - tens of seconds on a phone - and a page told 409 loaded
  // the document into the same old copy, once per url, a document load per
  // tap for as long as that took.
  const source = SERVICE_WORKER('abc123abc123', ['/', '/login'])

  /** The predicate, with a registration and a reported server build of the test's choosing. */
  function maybeStale(opts: { installing?: boolean; waiting?: boolean; serverBuild?: string | null }) {
    const body = source.match(/const maybeStale = ([\s\S]*?)\n}\n/)![1] + '\n}'

    return new Function(
      'self',
      'serverBuild',
      'hit',
      `const fn = ${body}; return fn(hit)`,
    ) as (self: unknown, serverBuild: string | null, hit: unknown) => boolean
    // Bound per call below.
  }

  const copy = (build: string | null) => ({ headers: new Headers(build ? { 'X-RSC-Version': build } : {}) })
  const self = (installing = false, waiting = false) => ({ registration: { installing: installing ? {} : null, waiting: waiting ? {} : null } })

  test('is served from the network once a page has reported the server on another build', () => {
    const fn = maybeStale({})

    expect(fn(self(), 'build-b', copy('build-a'))).toBe(true)
    expect(fn(self(), 'build-a', copy('build-a'))).toBe(false)
  })

  test('and while a newer worker is installing or waiting behind this one', () => {
    const fn = maybeStale({})

    expect(fn(self(true), null, copy('build-a'))).toBe(true)
    expect(fn(self(false, true), null, copy('build-a'))).toBe(true)
  })

  test('with nothing reported and nothing installing, the cache answers as before', () => {
    const fn = maybeStale({})

    expect(fn(self(), null, copy('build-a'))).toBe(false)
    expect(fn(self(), null, null)).toBe(false)
    // A copy that says no build at all is not known to be stale.
    expect(fn(self(), 'build-b', copy(null))).toBe(false)
  })

  test('the network is what a stale copy waits for, with the copy as the fallback', () => {
    expect(source).toContain('if (maybeStale(hit)) return fresh.catch(() => hit)')
  })

  test('a page reports the build by message, and is answered on its port', () => {
    expect(source).toContain("data.type === 'rsc-kit:server-build'")
    expect(source).toContain("event.ports[0].postMessage({ type: 'rsc-kit:server-build'")
  })
})

describe("the worker reads its own cache and no other", () => {
  // caches.match() searches every cache on the origin, the previous
  // worker's included until this one's activation sweeps it. A payload
  // request for the page was answered with the previous build's payload -
  // client references this build does not have - and the page reloaded to
  // recover, on every tap after a deploy until the sweep landed.
  const source = SERVICE_WORKER('abc123abc123', ['/', '/login'], [], '/offline')

  test('documents, payloads and the offline page come from this worker\'s cache', () => {
    expect(source).toContain("const own = (key, options) => caches.open(CACHE).then((cache) => cache.match(key, options))")
    expect(source).toContain('own(keyFor(request), MATCH)')
    expect(source).toContain('own(OFFLINE_URL)')
    // Only the content-addressed assets may come from any cache: the hash in
    // the name is the content, whichever worker stored it.
    // One in code, one in the comment that explains why.
    const inCode = source.split('\n').filter((line) => !line.trimStart().startsWith('//') && line.includes('caches.match('))

    expect(inCode).toHaveLength(1)
    expect(source).toMatch(/if \(immutable\(url\)\) \{\s*event\.respondWith\(\s*caches\.match\(request\)/)
  })
})

describe('an update always lands', () => {
  // A worker whose install rejects is never installed, and the one before it
  // stays in charge. With cache.addAll, one precached file that did not
  // arrive - a blip, a quota, a file a deploy replaced mid-install - failed
  // the whole install, and the old worker went on serving its build's pages.
  const ORIGIN = 'https://app.test'

  /** The generated worker's install, run against a cache and a network of the test's choosing. */
  async function install(opts: { failing?: string[]; hanging?: string[] }) {
    const worker = SERVICE_WORKER('abc123abc123', ['/', '/login', '/assets/app.js', '/assets/app.css'], [], '/offline')
      // Fast enough for a test; the real limit is thirty seconds.
      .replace('const INSTALL_FETCH_MS = 30000', 'const INSTALL_FETCH_MS = 50')
    const handlers: Record<string, (event: unknown) => void> = {}
    const stored = new Set<string>()
    let skippedWaiting = false
    const answer = (url: string) =>
      opts.failing?.includes(url) ? Promise.reject(new Error('404')) : opts.hanging?.includes(url) ? new Promise<never>(() => {}) : Promise.resolve()
    const cache = {
      // Through the same network as a direct fetch.
      add: (url: string) => fetch(url).then(() => void stored.add(url)),
      // As the Cache API has it: all or nothing.
      addAll: (urls: string[]) => Promise.all(urls.map(answer)).then(() => urls.forEach((url) => stored.add(url))),
      put: (key: Request | string) => (stored.add(typeof key === 'string' ? key : new URL(key.url).pathname + new URL(key.url).search), Promise.resolve()),
      match: async () => undefined,
    }
    const AbsoluteRequest = class extends Request {
      constructor(input: string | Request, init?: RequestInit) {
        super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init)
      }
    }
    const self = {
      addEventListener: (type: string, fn: (event: unknown) => void) => void (handlers[type] = fn),
      skipWaiting: () => ((skippedWaiting = true), Promise.resolve()),
      location: { origin: ORIGIN },
      registration: {},
      clients: { claim: async () => {}, matchAll: async () => [] },
      importScripts: () => {},
    }
    const caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => undefined }
    const fetch = async (input: Request | string) => {
      await answer(new URL(typeof input === 'string' ? input : input.url, ORIGIN).pathname)

      return new Response('payload', { headers: { 'Cache-Control': 'public, max-age=0' } })
    }
    const warned: string[] = []
    const console = { warn: (message: string) => void warned.push(message), log() {}, error() {} }

    new Function('self', 'caches', 'fetch', 'Request', 'console', worker)(self, caches, fetch, AbsoluteRequest, console)

    let installing: Promise<unknown> = Promise.resolve()

    handlers.install({ waitUntil: (promise: Promise<unknown>) => void (installing = promise) })
    await installing

    return { stored, skippedWaiting, warned }
  }

  test('with everything answering, everything is precached and the worker takes over', async () => {
    const { stored, skippedWaiting, warned } = await install({})

    expect(skippedWaiting).toBe(true)
    expect([...stored]).toEqual(expect.arrayContaining(['/', '/login', '/assets/app.js', '/assets/app.css', '/offline']))
    expect(warned).toEqual([])
  })

  test('a file that fails costs that file, not the update', async () => {
    const { stored, skippedWaiting, warned } = await install({ failing: ['/assets/app.css'] })

    expect(skippedWaiting).toBe(true)
    expect(stored.has('/assets/app.js')).toBe(true)
    expect(stored.has('/assets/app.css')).toBe(false)
    expect(warned.join('\n')).toContain('/assets/app.css was not precached')
  })

  test('a file that never answers is given up on, and the update still lands', async () => {
    const { stored, skippedWaiting, warned } = await install({ hanging: ['/login'] })

    expect(skippedWaiting).toBe(true)
    expect(stored.has('/')).toBe(true)
    expect(warned.join('\n')).toContain('/login was not precached')
  })

  test('even with nothing reachable at all', async () => {
    const all = ['/', '/login', '/assets/app.js', '/assets/app.css', '/offline']
    const { skippedWaiting } = await install({ failing: all })

    expect(skippedWaiting).toBe(true)
  })
})

describe('what the worker sends on to the network', () => {
  // What each request costs: the worker's own fetches, counted.
  const ORIGIN = 'https://app.test'

  /** The worker's fetch handler, against a network that answers everything. */
  async function respond(url: string, opts: { navigate?: boolean; storable?: boolean; also?: string } = {}) {
    const worker = SERVICE_WORKER('abc123abc123', ['/'], [], null)
    const handlers: Record<string, (event: unknown) => void> = {}
    const seen: { url: string; rsc: boolean }[] = []
    const fetch = (request: Request) => {
      seen.push({ url: new URL(request.url).pathname, rsc: !!request.headers.get('X-RSC') })

      return Promise.resolve(new Response('fresh ' + seen.length, { headers: { 'Cache-Control': opts.storable ? 'public, max-age=0' : 'no-store' } }))
    }
    const cache = {
      match: async () => undefined,
      put: async () => {},
    }
    const self = {
      addEventListener: (type: string, fn: (event: unknown) => void) => void (handlers[type] = fn),
      location: { origin: ORIGIN },
      registration: {},
      clients: { claim: async () => {}, matchAll: async () => [] },
      skipWaiting: async () => {},
    }
    const caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => undefined }
    const AbsoluteRequest = class extends Request {
      constructor(input: string | Request, init?: RequestInit) {
        super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init)
      }
    }

    new Function('self', 'caches', 'fetch', 'Request', 'console', worker)(self, caches, fetch, AbsoluteRequest, { warn() {}, log() {}, error() {} })

    // A navigation's request cannot be built with mode 'navigate'; this is its shape.
    const make = (target: string) =>
      opts.navigate
        ? ({ url: ORIGIN + target, method: 'GET', mode: 'navigate', headers: new Headers(), clone: () => new Request(ORIGIN + target) } as unknown as Request)
        : new Request(ORIGIN + target, { headers: { 'X-RSC': '1' } })
    const answers: Promise<Response>[] = []

    for (const target of opts.also ? [url, opts.also] : [url]) {
      handlers.fetch({ request: make(target), respondWith: (p: Promise<Response>) => void answers.push(p) })
    }

    const response = await answers[0]!
    await Promise.all(answers.slice(1))

    return { response, seen }
  }

  test('a page load is one request - its payload is not fetched a second time behind it', async () => {
    // The page asks for its payload itself, through this same worker, which
    // caches it. A second fetch of it here was a duplicate on every load.
    const { seen } = await respond('/agent', { navigate: true, storable: true })

    await new Promise((r) => setTimeout(r, 20))
    expect(seen.filter((r) => r.rsc)).toEqual([])
    expect(seen).toHaveLength(1)
  })

  test('two payloads of one page fetch its document once', async () => {
    const { seen } = await respond('/agent', { storable: true, also: '/agent' })

    await new Promise((r) => setTimeout(r, 20))
    expect(seen.filter((r) => !r.rsc)).toHaveLength(1)
  })

  test('a request that answers is asked once - no extra traffic', async () => {
    const { response, seen } = await respond('/agent')

    expect(await response.text()).toBe('fresh 1')
    await new Promise((r) => setTimeout(r, 80))
    expect(seen).toHaveLength(1)
  })
})

describe("the worker's version", () => {
  // A deploy that changed a stored page and no client script left sw.js
  // byte for byte the same, so the browser never updated the worker and it
  // served the previous build's page from its cache, cache-first.
  const precache = ['/', '/assets/app-abc12345.js']
  const storedWith = (home: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'stored-'))

    writeFileSync(join(dir, 'index.html'), home)
    mkdirSync(join(dir, 'posts'))
    writeFileSync(join(dir, 'posts', 'one.html'), '<p>one</p>')

    return dir
  }

  test('changes when a stored page changes, though no file name did', () => {
    expect(workerVersion(precache, storedWith('<h1>A</h1>'))).not.toBe(workerVersion(precache, storedWith('<h1>B</h1>')))
  })

  test('is the same for the same build, wherever it was written', () => {
    expect(workerVersion(precache, storedWith('<h1>A</h1>'))).toBe(workerVersion(precache, storedWith('<h1>A</h1>')))
  })

  test('still changes when the precached files do', () => {
    const stored = storedWith('<h1>A</h1>')

    expect(workerVersion(precache, stored)).not.toBe(workerVersion([...precache, '/assets/new-abcdef12.js'], stored))
  })
})
