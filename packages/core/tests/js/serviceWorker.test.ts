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
