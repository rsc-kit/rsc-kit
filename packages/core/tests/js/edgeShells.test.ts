/**
 * Which pages `.output/ppr.json` tells an edge it may serve from a cached
 * shell: patterns, never a guarded page, never one an edge cannot match.
 */

import { describe, expect, test } from 'bun:test'
import { edgeShells, MAX_SHELLS, pprMarker } from '../../src/edgeShells'
import type { RouteSegment } from '../../src/manifest'

const s = (value: string): RouteSegment => ({ type: 'static', value })
const p = (value: string): RouteSegment => ({ type: 'param', value })
const all = (value: string): RouteSegment => ({ type: 'catchAll', value })
const route = (component: string, segments: RouteSegment[], guards: { middleware?: string[]; hostMiddleware?: string[] } = {}) => ({
  component,
  segments,
  ...guards,
})
const shell = (component: string) => ({ type: 'shell', component })

describe('edgeShells', () => {
  test('lists the pattern of each page with a shell, / for the index', () => {
    const routes = [
      route('app/page', []),
      route('app/dashboard/page', [s('dashboard')]),
      route('app/[team]/[app]/page', [p('team'), p('app')]),
      route('app/docs/[...slug]/page', [s('docs'), all('slug')]),
    ]
    const results = routes.map((r) => shell(r.component))

    expect(edgeShells(results, routes).shells).toEqual(['/', '/[team]/[app]', '/dashboard', '/docs/[...slug]'])
  })

  test('a page stored whole, or rendered per request, is not a shell', () => {
    const routes = [route('app/about/page', [s('about')]), route('app/live/page', [s('live')])]

    expect(edgeShells([{ type: 'frozen', component: 'app/about/page' }, { type: 'dynamic', component: 'app/live/page' }], routes).shells).toEqual([])
  })

  test('a guarded page is left out, by a middleware.ts or by the host', () => {
    const routes = [
      route('app/admin/page', [s('admin')], { middleware: ['app/admin/middleware'] }),
      route('app/billing/page', [s('billing')], { hostMiddleware: ['auth'] }),
      route('app/open/page', [s('open')]),
    ]

    expect(edgeShells(routes.map((r) => shell(r.component)), routes).shells).toEqual(['/open'])
  })

  test('route groups and slots are already out of the segments; one pattern is listed once', () => {
    const routes = [route('app/(shop)/cart/page', [s('cart')])]

    expect(edgeShells([shell('app/(shop)/cart/page'), shell('app/(shop)/cart/page')], routes).shells).toEqual(['/cart'])
  })

  test('a page bound from the host, and an optional catch-all, cannot be matched by path and are left out', () => {
    const routes = [
      route('app/[domain]/page', [{ type: 'host', value: 'domain' }]),
      route('app/shop/[[...rest]]/page', [s('shop'), p('[...rest]')]),
    ]

    expect(edgeShells(routes.map((r) => shell(r.component)), routes).shells).toEqual([])
  })

  test('a pattern of exactly 200 bytes is listed, and a longer one is left out and said', () => {
    const fits = 'x'.repeat(199)
    const long = 'y'.repeat(200)
    const routes = [route(`app/${fits}/page`, [s(fits)]), route(`app/${long}/page`, [s(long)])]
    const { shells, left } = edgeShells(routes.map((r) => shell(r.component)), routes)

    expect(shells).toEqual([`/${fits}`])
    expect(left[0]).toContain('over 200 bytes')
  })

  test(`at most ${MAX_SHELLS}, the shallowest kept, and the rest are said`, () => {
    const deep = route('app/a/b/c/page', [s('a'), s('b'), s('c')])
    const routes = [deep, ...Array.from({ length: MAX_SHELLS }, (_, i) => route(`app/p${i}/page`, [s(`p${i}`)]))]
    const { shells, left } = edgeShells(routes.map((r) => shell(r.component)), routes)

    expect(shells).toHaveLength(MAX_SHELLS)
    expect(shells).not.toContain('/a/b/c')
    expect(left).toEqual([`1 past the shallowest ${MAX_SHELLS}`])
  })
})

describe('pprMarker', () => {
  test('the contract v1 marker, with this framework\'s own payload requests to bypass', () => {
    expect(pprMarker('b7c1e0f4', [])).toEqual({ v: 1, build: 'b7c1e0f4', shells: [], bypass: { headers: ['X-RSC'] } })
  })
})
