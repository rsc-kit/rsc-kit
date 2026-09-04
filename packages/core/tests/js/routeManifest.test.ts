/**
 * What the plugin knows about the route tree, written out for a host.
 *
 * The plugin already walks app/ to generate the entries. Laravel walks it again
 * to work out the same things — which url a component answers, what wraps it —
 * and a JS host would otherwise have to write a third walk. These pin the
 * answers so one walk can serve all of them.
 *
 * Checked against the real fixture rather than a synthetic tree, because the
 * cases that matter are the awkward ones: groups that vanish from urls, slot
 * directories that are not url segments, interceptors that are not routes.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const packageRoot = join(import.meta.dir, '../..')
const outDir = join(packageRoot, '.tmp/vite-test')

interface Segment { type: string; value: string }
interface Intercept {
  component: string
  slot: string
  segments: Segment[]
}

interface Route {
  component: string
  segments: Segment[]
  layouts: string[]
  loadings: string[]
  slots: Record<string, string>
  sections: string[]
}

let manifest: { version: number; routes: Route[]; intercepts: Intercept[] }

/** The url a host would build from the segments, in Laravel's dialect. */
const urlOf = (r: Route) =>
  '/' + r.segments.map((s) => (s.type === 'static' ? s.value : `{${s.value}}`)).join('/')

const route = (url: string) => manifest.routes.find((r) => urlOf(r) === url)

beforeAll(async () => {
  const build = Bun.spawn(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
    cwd: packageRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      RSC_PROJECT_ROOT: packageRoot,
      RSC_SOURCE_DIR: join(packageRoot, 'tests/fixtures/rsc-app'),
      RSC_OUT_DIR: outDir,
      RSC_ASSETS_DIR: join(outDir, 'public'),
      RSC_VITE_CONFIG: join(packageRoot, 'tests/fixtures/vite.rsc.config.mjs'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if ((await build.exited) !== 0) {
    throw new Error(`fixture build failed:\n${await new Response(build.stderr).text()}`)
  }

  manifest = JSON.parse(readFileSync(join(outDir, 'routes.json'), 'utf-8'))
}, 180_000)

describe('the route manifest', () => {
  test('is written where a host can read it', () => {
    expect(manifest.version).toBe(1)
    expect(manifest.routes.length).toBeGreaterThan(0)
  })

  test('names a url in segments, not in a host dialect', () => {
    // Laravel writes {slug}, Hono writes :slug, and neither is the plugin's
    // business — so it says what the segment is and lets the host spell it.
    const dynamic = route('/photo/{id}')

    expect(dynamic).toBeDefined()
    expect(dynamic!.segments).toEqual([
      { type: 'static', value: 'photo' },
      { type: 'param', value: 'id' },
    ])
  })

  test('gives a page the layouts that wrap it, outermost first', () => {
    expect(route('/nested')!.layouts).toEqual(['app/layout', 'app/nested/layout'])
  })

  test('a page under no nested layout still gets the root one', () => {
    expect(route('/feed')!.layouts).toEqual(['app/layout'])
  })

  test('a route group organises files without appearing in the url', () => {
    // (marketing) is how a section of an app gets its own layout without
    // putting a segment in every url beneath it.
    expect(route('/promo')).toBeDefined()
    expect(manifest.routes.map(urlOf)).not.toContain('/(marketing)/promo')
  })

  test('a slot directory is not a url segment either', () => {
    // @modal names a region; the interceptor inside it answers the url of the
    // page it intercepts, not one containing @modal.
    const intercept = manifest.intercepts[0]

    expect(intercept.segments.map((s) => s.value)).not.toContain('modal')
    expect(intercept.segments).toEqual([
      { type: 'static', value: 'photo' },
      { type: 'param', value: 'id' },
    ])
    // The marker is kept as its own field: it says where the intercepted url
    // lives relative to here, which the segments alone cannot express.
    expect(intercept.marker).toBe('(.)')
  })

  test('an interceptor is not a route', () => {
    // It renders into a slot on a page that already exists; registering it as
    // a page of its own would make it navigable, which is the opposite of the
    // point.
    for (const r of manifest.routes) {
      expect(r.component).not.toContain('(.)')
    }

    expect(manifest.intercepts).toHaveLength(1)
    expect(manifest.intercepts[0]).toMatchObject({ slot: 'modal' })
  })

  test('a page carries the slots that belong to it', () => {
    expect(route('/feed')!.slots).toEqual({ modal: 'app/@modal/default' })
  })

  test('a page carries its sections', () => {
    // The light form of a nameable region — one file, no layout wiring.
    expect(route('/ledger')!.sections).toEqual(['app/ledger/orders.section'])
  })

  test('a page with no sections says so rather than omitting the key', () => {
    // A host reading this should not have to distinguish absent from empty.
    expect(route('/feed')!.sections).toEqual([])
  })
})

describe('routes that declare their own urls', () => {
  test('the manifest says which pages were asked', () => {
    // So a host can plan a build — which routes to ask for urls, which to
    // leave on demand — without loading the server bundle to find out.
    const photo = manifest.routes.find((r) => r.component === 'app/photo/[id]/page')
    const plain = manifest.routes.find((r) => r.component === 'app/page')

    expect((photo as { staticParams?: boolean }).staticParams).toBe(true)
    expect((plain as { staticParams?: boolean }).staticParams).toBe(false)
  })
})
