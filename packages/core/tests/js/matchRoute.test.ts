import { describe, expect, test } from 'bun:test'
import { matchApiRoute, matchRoute } from '../../src/routing'
import type { ManifestRoute, RouteManifest, RouteSegment } from '../../src/manifest'

const seg = (pattern: string): RouteSegment[] =>
  pattern
    .split('/')
    .filter(Boolean)
    .map((s) =>
      s.startsWith('[...')
        ? { type: 'catchAll', value: s.slice(4, -1) }
        : s.startsWith('[')
          ? { type: 'param', value: s.slice(1, -1) }
          : { type: 'static', value: s },
    )

const route = (pattern: string): ManifestRoute =>
  ({
    component: `app${pattern === '/' ? '' : pattern}/page`,
    segments: seg(pattern),
    layouts: [],
    loadings: [],
    middleware: [],
    slots: {},
    sections: [],
    config: null,
    ancestorConfigs: [],
    staticParams: false,
  }) as never

const manifest = (...patterns: string[]): RouteManifest =>
  ({
    version: 1,
    build: { output: 'server', exportPath: 'dist', payloadName: '' },
    routes: patterns.map(route),
    apis: [
      { ...route('/api/health'), name: 'app/api/health/route', methods: ['GET'] },
      { ...route('/api/items/[id]'), name: 'app/api/items/[id]/route', methods: ['GET'] },
    ],
    intercepts: [],
  }) as never

describe('matching a url to a route', () => {
  const m = manifest('/', '/posts', '/posts/[slug]', '/docs/[...path]', '/posts/new')

  test('a fully static path is answered without scoring anything', () => {
    // The map is the fast path; these are the requests most apps mostly get.
    expect(matchRoute(m, '/posts')?.route.component).toBe('app/posts/page')
    expect(matchRoute(m, '/posts/')?.route.component).toBe('app/posts/page')
    expect(matchRoute(m, '/')?.route.component).toBe('app/page')
  })

  test('a static route beats a param on the same path, however they are ordered', () => {
    expect(matchRoute(m, '/posts/new')?.route.component).toBe('app/posts/new/page')
    expect(matchRoute(m, '/posts/hello')).toMatchObject({ params: { slug: 'hello' } })
  })

  test('a catch-all is the weakest match and binds the rest', () => {
    expect(matchRoute(m, '/docs/a/b/c')).toMatchObject({ params: { path: 'a/b/c' } })
    expect(matchRoute(m, '/nothing/here')).toBeNull()
  })

  test('the index is per manifest object, so a swapped manifest is not answered from the old one', () => {
    const other = manifest('/only')

    expect(matchRoute(other, '/posts')).toBeNull()
    expect(matchRoute(other, '/only')?.route.component).toBe('app/only/page')
    expect(matchRoute(m, '/posts')?.route.component).toBe('app/posts/page')
  })

  test('api routes take the same two paths', () => {
    expect(matchApiRoute(m, '/api/health')?.route.name).toBe('app/api/health/route')
    expect(matchApiRoute(m, '/api/items/42')).toMatchObject({ params: { id: '42' } })
    expect(matchApiRoute(m, '/api/nope')).toBeNull()
  })
})
