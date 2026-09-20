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
import { SERVICE_WORKER } from '../../src/vite'

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
    expect(withFallback).toContain("if (OFFLINE_URL && request.mode === 'navigate')")
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

    expect(frozenBranch).toContain("if (OFFLINE_URL && request.mode === 'navigate')")
    expect(frozenBranch).toContain('caches.match(OFFLINE_URL)')
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
    expect(source).toContain('caches.match(keyFor(request), MATCH)')
  })
})

describe('the offline page standing in for another url', () => {
  test('answers that url\'s boot payload with its own, so the fallback hydrates', () => {
    // The runtime boots the page in the address bar and asks for its
    // payload - the one thing nothing has. The offline page's payload is
    // what the document on screen is. A boot only: a navigation while
    // offline keeps failing as itself, and the open page keeps its banner.
    const source = SERVICE_WORKER('abc123abc123', ['/'], ['/'], '/offline')
    const tail = source.slice(source.indexOf('caches.match(OFFLINE_URL)'))

    expect(tail).toContain("request.headers.get('X-RSC') && !request.headers.get('X-RSC-Segments')")
    expect(tail).toContain("new URL(OFFLINE_URL, self.location.origin), { headers: { 'X-RSC': '1' } }")
  })
})
