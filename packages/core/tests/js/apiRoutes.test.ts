// `route.ts` — an api endpoint colocated with the pages it sits among.
//
// The url comes from the directory, the same way a page's does, so the matcher
// is the one pages already use and `[id]` works without being taught to.

import { describe, expect, test } from 'bun:test'
import { allowFor, matchApiRoute } from '../../src/routing'
import type { ManifestApiRoute, RouteManifest } from '../../src/manifest'

const segments = (spec: string) =>
  spec
    .split('/')
    .filter(Boolean)
    .map((part) =>
      part.startsWith('[...')
        ? { type: 'catchAll' as const, value: part.slice(4, -1) }
        : part.startsWith('[')
          ? { type: 'param' as const, value: part.slice(1, -1) }
          : { type: 'static' as const, value: part },
    )

const api = (url: string, methods: string[], middleware: string[] = []): ManifestApiRoute => ({
  name: `app${url}/route`,
  segments: segments(url),
  methods,
  middleware,
})

const manifest = (apis: ManifestApiRoute[]): RouteManifest => ({
  version: 1,
  build: { output: 'server', exportPath: 'dist', payloadName: '' },
  routes: [],
  intercepts: [],
  apis,
})

describe('matching an api route', () => {
  test('a static url', () => {
    const m = manifest([api('/api/health', ['GET'])])

    expect(matchApiRoute(m, '/api/health')?.route.name).toBe('app/api/health/route')
    expect(matchApiRoute(m, '/api/other')).toBeNull()
  })

  test('binds a dynamic segment', () => {
    const m = manifest([api('/api/greet/[name]', ['GET'])])
    const hit = matchApiRoute(m, '/api/greet/ramon')

    expect(hit?.params).toEqual({ name: 'ramon' })
  })

  test('a static segment beats a dynamic one', () => {
    // Same rule pages follow. Without it /api/user/me would be answered by
    // [id] half the time, depending on declaration order.
    const m = manifest([api('/api/user/[id]', ['GET']), api('/api/user/me', ['GET'])])

    expect(matchApiRoute(m, '/api/user/me')?.route.name).toBe('app/api/user/me/route')
    expect(matchApiRoute(m, '/api/user/42')?.route.name).toBe('app/api/user/[id]/route')
  })

  test('a catch-all is the weakest match', () => {
    const m = manifest([api('/api/[...rest]', ['GET']), api('/api/health', ['GET'])])

    expect(matchApiRoute(m, '/api/health')?.route.name).toBe('app/api/health/route')
    expect(matchApiRoute(m, '/api/a/b/c')?.route.name).toBe('app/api/[...rest]/route')
  })

  test('a manifest from before api routes existed matches nothing', () => {
    // `apis` is optional, so an old bundle falls through to page routing —
    // which is what that bundle would have done anyway.
    const old = { ...manifest([]), apis: undefined }

    expect(matchApiRoute(old, '/api/health')).toBeNull()
  })
})

describe('what a 405 says is allowed', () => {
  test('lists what the file exports', () => {
    expect(allowFor(api('/x', ['GET', 'POST']))).toBe('GET, POST, HEAD')
  })

  test('adds HEAD wherever GET is, because GET answers it', () => {
    expect(allowFor(api('/x', ['GET']))).toBe('GET, HEAD')
  })

  test('but not to a route with no GET', () => {
    expect(allowFor(api('/x', ['POST']))).toBe('POST')
  })

  test('and does not repeat one the route exported itself', () => {
    expect(allowFor(api('/x', ['GET', 'HEAD']))).toBe('GET, HEAD')
  })
})

describe('the guards above a route', () => {
  test('a route carries the middleware chain of its directory', () => {
    // The whole point: a route.ts sits among the pages it belongs with, so
    // adding one under a guarded path must not open a way around the guard.
    const guarded = api('/admin/api/export', ['GET'], ['app/admin/middleware'])

    expect(guarded.middleware).toEqual(['app/admin/middleware'])
  })

  test('and a route outside a guarded directory carries none', () => {
    expect(api('/api/health', ['GET']).middleware).toEqual([])
  })
})
