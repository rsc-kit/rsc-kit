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
