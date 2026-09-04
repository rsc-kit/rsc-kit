// Rendering pages at build time, against the real fixture bundle.
//
// The engine renders; the prerenderer decides what to render and what to keep.
// These assert on those decisions — which urls exist, which pages can be
// frozen, and whether what came out can actually be served back at the depth a
// client asks for.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prerender, pathKey, urlFor, urlsToBuild } from '../../src/prerender.ts'
import { exportSite } from '../../src/export.ts'
import { prerenderedFrom, writeTo } from '../../src/files.ts'
import type { PrerenderResult } from '../../src/prerender.ts'
import type { RouteManifest } from '../../src/manifest.ts'
import { createRscHandler } from '../../src/host.ts'

const packageRoot = join(import.meta.dir, '../..')
const bundlePath = join(packageRoot, '.tmp/vite-test/dist/rsc/index.js')

let engine: any
let outDir: string
let results: Awaited<ReturnType<typeof prerender>>

beforeAll(async () => {
  // Always, not only when missing: a fixture page added since the last run
  // would otherwise be absent from the bundle, and the failure reads as the
  // prerenderer ignoring a route rather than as a stale build.
  {
    const proc = Bun.spawn(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        RSC_PROJECT_ROOT: packageRoot,
        RSC_SOURCE_DIR: join(packageRoot, 'tests/fixtures/rsc-app'),
        RSC_OUT_DIR: join(packageRoot, '.tmp/vite-test'),
        RSC_ASSETS_DIR: join(packageRoot, '.tmp/vite-test/public'),
        RSC_VITE_CONFIG: join(packageRoot, 'tests/fixtures/vite.rsc.config.mjs'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if ((await proc.exited) !== 0) {
      throw new Error(`fixture build failed:\n${await new Response(proc.stderr).text()}`)
    }
  }

  engine = await import(bundlePath)
  engine.installHostFn(async () => ({ display: 'ramon' }))

  outDir = mkdtempSync(join(tmpdir(), 'rsc-prerender-'))
  results = await prerender({ engine, write: writeTo(outDir), version: 'build-1' })
  // Every fixture route gets a shell probe, and the slow ones are slow on
  // purpose — the budget has to cover the build plus all of them.
}, 180_000)

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

const wrote = (name: string) => existsSync(join(outDir, name))
const resultFor = (url: string) => results.find((r) => r.url === url)

describe('which urls exist', () => {
  test('a route with no params is one url', () => {
    expect(urlFor({ segments: [{ type: 'static', value: 'feed' }] } as never, {})).toBe('/feed')
  })

  test('a parameterised route takes its values from the params', () => {
    expect(
      urlFor(
        {
          segments: [
            { type: 'static', value: 'photo' },
            { type: 'param', value: 'id' },
          ],
        } as never,
        { id: '7' },
      ),
    ).toBe('/photo/7')
  })

  test('the root is stored as index', () => {
    // '' is not a filename.
    expect(pathKey('/')).toBe('index')
    expect(pathKey('/photo/7')).toBe('photo/7')
  })

  test('a route that declares its urls contributes one entry each', async () => {
    const entries = await urlsToBuild(engine.manifest(), engine)
    const photos = entries.filter((e) => e.route.component === 'app/photo/[id]/page')

    expect(photos.map((e) => e.url).sort()).toEqual(['/photo/1', '/photo/2'])
  })

  test('a parameterised route that declares none contributes nothing', async () => {
    // Not an error: rendering on demand is a legitimate answer, and the
    // alternative is guessing at slugs the app never listed.
    const manifest = engine.manifest()
    const entries = await urlsToBuild(manifest, {
      ...engine,
      getStaticParams: async () => null,
    } as never)

    expect(entries.some((e) => e.route.component === 'app/photo/[id]/page')).toBe(false)
  })

  test('a route the manifest says declares none is not even asked', async () => {
    // The flag exists so a host can plan a build without running app code.
    // Reaching for the export anyway makes it decorative — and the fixture has
    // no undeclared parameterised route to notice with, so this states the
    // table rather than borrowing one.
    const asked: string[] = []
    const route = (component: string, staticParams: boolean) => ({
      component,
      segments: [
        { type: 'static' as const, value: component.split('/')[1] },
        { type: 'param' as const, value: 'id' },
      ],
      layouts: [],
      loadings: [],
      slots: {},
      sections: [],
      config: null,
      ancestorConfigs: [],
      staticParams,
    })

    await urlsToBuild(
      {
        version: 1,
        build: { output: 'server', exportPath: 'dist', payloadName: '' },
        routes: [route('app/declared/[id]/page', true), route('app/undeclared/[id]/page', false)],
        intercepts: [],
      },
      {
        getStaticParams: async (component: string) => {
          asked.push(component)

          return [{ id: '1' }]
        },
      } as never,
    )

    expect(asked).toEqual(['app/declared/[id]/page'])
  })

  test('interceptors are never urls of their own', async () => {
    const entries = await urlsToBuild(engine.manifest(), engine)

    expect(entries.some((e) => e.route.component.includes('(.'))).toBe(false)
  })
})

describe('which pages can be frozen', () => {
  test('a page that renders without reaching for anything is written', () => {
    expect(resultFor('/static')?.type).toBe('static')
    expect(wrote('static.html')).toBe(true)
    expect(wrote('static.flight')).toBe(true)
  })

  test('a page that reaches for the host ships a shell instead', () => {
    // Not frozen whole — that would bake one request's data into every
    // response — but not given up on either. The probe's timeout is the
    // ordinary path here: React flushed everything that does not depend on
    // the host, and that markup is the shell.
    expect(resultFor('/')?.type).toBe('ppr')
    expect(wrote('index.html')).toBe(false)
    expect(wrote('index.ppr.html')).toBe(true)
  })

  test('so does one whose slow work sits behind Suspense', () => {
    expect(resultFor('/slow')?.type).toBe('ppr')
  })

  test('the shell holds the fallbacks, not the data behind them', () => {
    const shell = readFileSync(join(outDir, 'slow.ppr.html'), 'utf-8')

    expect(shell).toContain('slow-shell')
    expect(shell).toContain('loading slow')
    // The data never resolved during the probe, and must not appear as though
    // it had — a frozen shell claiming one request's answer is worse than no
    // shell at all.
    expect(shell).not.toContain('from hono')
  })

  test('an aborted render is closed, so the document is valid', () => {
    // The render is cut off mid-stream once the shell is out, which leaves
    // <body> and <html> open.
    const shell = readFileSync(join(outDir, 'slow.ppr.html'), 'utf-8')

    expect(shell.trimEnd()).toEndWith('</html>')
  })

  test('a page that blocks before anything paints has no shell to ship', async () => {
    // With no boundary above the blocking work, nothing is flushed — so there
    // is nothing to freeze and it can only render on demand. The build refuses
    // this shape anyway, which is why the fixture has to be told to forget its
    // loading.tsx to produce it.
    const manifest = engine.manifest()
    const bare = {
      ...manifest,
      routes: manifest.routes
        .filter((r: { component: string }) => r.component === 'app/page')
        .map((r: object) => ({ ...r, loadings: [] })),
    }

    const [result] = await prerender({ engine, manifest: bare, write: () => {} })

    expect(result.type).toBe('dynamic')
    expect(result.reason).toMatch(/host/)
  }, 30_000)
})

describe('routes whose urls were never listed', () => {
  const withoutParams = () => {
    const manifest = engine.manifest()

    return {
      ...manifest,
      routes: manifest.routes.map((r: { staticParams: boolean }) => ({ ...r, staticParams: false })),
    }
  }

  test('ship one shell for the whole pattern', async () => {
    // Nothing in a shell varies by param, so the same markup serves every url
    // the route matches. This is most of PPR's value — the routes you can
    // enumerate are the ones you could already freeze whole.
    const dir = mkdtempSync(join(tmpdir(), 'rsc-pattern-'))
    const results = await prerender({ engine, manifest: withoutParams(), write: writeTo(dir) })

    expect(results.find((r) => r.component === 'app/item/[id]/page')?.type).toBe('ppr')
    expect(existsSync(join(dir, 'item/_id_.ppr.html'))).toBe(true)

    // The shell holds the fallback, never the placeholder the build invented.
    const shell = readFileSync(join(dir, 'item/_id_.ppr.html'), 'utf-8')

    expect(shell).toContain('item-fallback')
    expect(shell).not.toContain('item-detail')

    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  test('are refused when the page renders its params before it can paint', async () => {
    // The photo page prints its id directly. A shell for it would contain the
    // placeholder the build invented, served as though it were a real id.
    const dir = mkdtempSync(join(tmpdir(), 'rsc-pattern-'))
    const results = await prerender({ engine, manifest: withoutParams(), write: writeTo(dir) })
    const photo = results.find((r) => r.component === 'app/photo/[id]/page')

    expect(photo?.type).toBe('dynamic')
    expect(photo?.reason).toMatch(/params/)
    expect(existsSync(join(dir, 'photo/_id_.ppr.html'))).toBe(false)
    expect(existsSync(join(dir, 'photo/_.html'))).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  }, 60_000)
})

describe('a route that ships no client runtime', () => {
  test('is refused when the tree renders a client component', () => {
    // Inert markup otherwise — a button that does nothing. The fixture's root
    // layout renders <Nav>, which is exactly how this happens in practice:
    // inherited from a shared layout rather than written on the page.
    const plain = resultFor('/plain')

    expect(plain?.type).toBe('error')
    expect(plain?.reason).toMatch(/Nav/)
    expect(plain?.reason).toMatch(/shared layout/)
  })

  test('renders to html with no bootstrap when nothing needs one', async () => {
    // The floor this buys back is React itself, on a page with nothing to
    // hydrate. Rendered without the fixture's layout, since that layout is
    // what pulls a client component in.
    const manifest = engine.manifest()
    const dir = mkdtempSync(join(tmpdir(), 'rsc-plain-'))

    const results = await prerender({
      engine,
      write: writeTo(dir),
      manifest: {
        ...manifest,
        routes: manifest.routes
          .filter((r: { component: string }) => r.component === 'app/plain/page')
          .map((r: object) => ({ ...r, layouts: [], loadings: [], slots: {} })),
      },
    })

    expect(results[0].type).toBe('static')

    const html = readFileSync(join(dir, 'plain.html'), 'utf-8')

    expect(html).toContain('A page that ships no JavaScript')
    expect(html).not.toMatch(/<script/)

    rmSync(dir, { recursive: true, force: true })
  }, 30_000)
})

describe('what gets written', () => {
  test('a variant for every depth a client might already hold', () => {
    // Without them every navigation to a prerendered route is a whole
    // document, which replaces the root and unmounts the pages retained
    // behind it — so going back does not restore the form you were filling in.
    expect(wrote('static.seg1.flight')).toBe(true)
  })

  test('the layout chain, so a host knows what the variants are for', () => {
    const meta = JSON.parse(readFileSync(join(outDir, 'static.meta.json'), 'utf-8'))

    expect(meta.layouts).toEqual(['app/layout'])
    expect(meta.version).toBe('build-1')
  })

  test('the page a layout declares a slot for is rendered into it', () => {
    // A frozen page whose layout declares a parallel slot comes out whole
    // apart from that region, and nothing says so — the file is written, the
    // build succeeds, and the modal is simply absent for ever.
    expect(readFileSync(join(outDir, 'static.html'), 'utf-8')).toContain('modal-default')
  })

  test('the document carries the bootstrap that makes it interactive', () => {
    const html = readFileSync(join(outDir, 'static.html'), 'utf-8')

    expect(html).toContain('<html')
    expect(html).toMatch(/<script/)
  })
})

describe('serving what was written', () => {
  const handler = () =>
    createRscHandler({ engine, prerendered: prerenderedFrom(outDir), version: 'build-1' })

  test('a plain request gets the frozen document', async () => {
    const res = await handler()(new Request('http://x/static'))

    expect(res?.status).toBe(200)
    expect(await res!.text()).toContain('<html')
  })

  test('a client holding the layout gets the segment, not the document', async () => {
    const res = await handler()(
      new Request('http://x/static', {
        headers: { 'X-RSC': '1', 'X-RSC-Segments': 'app/layout' },
      }),
    )

    expect(res?.headers.get('X-RSC-Segment-Depth')).toBe('1')
  })

  test('a client holding nothing gets the whole document payload', async () => {
    const res = await handler()(new Request('http://x/static', { headers: { 'X-RSC': '1' } }))

    expect(res?.headers.get('X-RSC-Segment-Depth')).toBe('0')
  })

  test('a client claiming a chain this route does not have gets the document', async () => {
    // Its layouts differ, so nothing is shared and no variant applies.
    const res = await handler()(
      new Request('http://x/static', {
        headers: { 'X-RSC': '1', 'X-RSC-Segments': 'app/other/layout' },
      }),
    )

    expect(res?.headers.get('X-RSC-Segment-Depth')).toBe('0')
  })

  test('a page with only a shell serves the shell', async () => {
    const res = await handler()(new Request('http://x/slow'))

    expect(await res!.text()).toContain('loading slow')
  })

  test('the payload that fills a shell is rendered now, never served frozen', async () => {
    // Answering with a frozen payload hands back the same fallbacks the shell
    // already shows, and the page never finishes loading.
    const handle = createRscHandler({
      engine,
      prerendered: prerenderedFrom(outDir),
      rpc: { slowData: async () => ({ value: 'resolved at request time' }) },
    })

    const body = await (await handle(new Request('http://x/slow', { headers: { 'X-RSC': '1' } })))!.text()

    expect(body).toContain('resolved at request time')
  }, 20_000)

  test('a url that was not frozen still renders', async () => {
    // A partial prerender is a valid state, not a broken one.
    const res = await handler()(new Request('http://x/feed'))

    expect(res?.status).toBe(200)
    expect(res?.headers.get('Content-Type')).toStartWith('text/html')
  })
})

describe('exporting the site as files', () => {
  const exportable: PrerenderResult[] = [
    { url: '/', component: 'app/page', type: 'static', reason: null },
    { url: '/docs', component: 'app/docs/page', type: 'static', reason: null },
  ]

  const forExport = (payloadName = 'index.rsc'): RouteManifest =>
    ({ version: 1, build: { output: 'export', exportPath: 'dist', payloadName }, routes: [], intercepts: [] })

  /**
   * A prerender output and a site, both in memory.
   *
   * No temp directories: the export reads and writes through functions, so a
   * Map is a complete substitute for a disk and the test says what it means
   * without cleanup that can outlive a failure.
   */
  function inMemory(frozen: string[]) {
    const source = new Map<string, string>()

    for (const key of frozen) {
      source.set(`${key}.html`, `<html><body>${key}</body></html>`)
      source.set(`${key}.flight`, `payload:${key}`)
    }

    const site = new Map<string, string>()

    return {
      source,
      site,
      read: (name: string) => source.get(name) ?? null,
      write: (path: string, contents: string) => {
        site.set(path, contents)
      },
    }
  }

  test('lays each route out as a directory with an index', async () => {
    // So urls stay extensionless: /docs, not /docs.html.
    const io = inMemory(['index', 'docs'])

    const { pages } = await exportSite({ results: exportable, ...io, manifest: forExport() })

    expect(pages).toBe(2)
    expect(io.site.get('index.html')).toContain('index')
    expect(io.site.get('docs/index.html')).toContain('docs')
  })

  test('puts the payload beside it, under the name the client asks for', async () => {
    // A static host cannot read the header that would otherwise select a
    // payload, so the client was built to ask for a file instead.
    const io = inMemory(['index'])

    await exportSite({ results: exportable.slice(0, 1), ...io, manifest: forExport('index.rsc') })

    expect(io.site.get('index.rsc')).toBe('payload:index')
  })

  test('refuses a site that is not fully static, naming what is not', async () => {
    // The failure it prevents is silent both ways: a shell serves a page that
    // loads and stays empty, and a missing route is a 404 at a url that
    // worked yesterday.
    const io = inMemory(['index'])

    const results: PrerenderResult[] = [
      ...exportable.slice(0, 1),
      { url: '/dashboard', component: 'app/dashboard/page', type: 'ppr', reason: null },
    ]

    const refusal = exportSite({ results, ...io, manifest: forExport() })

    await expect(refusal).rejects.toThrow(/\/dashboard/)
    await expect(refusal).rejects.toThrow(/nothing on a static host will fill it/)
  })

  test('exports the rest when told to, and still says what it left out', async () => {
    const io = inMemory(['index'])

    const { pages, refused } = await exportSite({
      results: [
        ...exportable.slice(0, 1),
        { url: '/dashboard', component: 'app/dashboard/page', type: 'ppr', reason: null },
      ],
      ...io,
      manifest: forExport(),
      force: true,
    })

    expect(pages).toBe(1)
    expect(refused.map((r) => r.url)).toEqual(['/dashboard'])
  })

  test('refuses a build whose client asks for payloads the wrong way', async () => {
    // Exporting a server build ships a client that asks with a header no
    // static host reads, so every navigation quietly falls back to a full
    // page load. The files would all be present and correct.
    const io = inMemory(['index'])

    await expect(
      exportSite({ results: exportable.slice(0, 1), ...io, manifest: forExport('') }),
    ).rejects.toThrow(/output: 'export'/)
  })

  test('brings a payload for every depth a client might hold', async () => {
    // Addressed by name, because a file server cannot vary on a header.
    // Without them every navigation on the exported site is a whole document,
    // which replaces the root and unmounts whatever was retained behind it.
    const io = inMemory(['docs'])

    io.source.set('docs.seg1.flight', 'from depth 1')
    io.source.set('docs.seg2.flight', 'from depth 2')

    await exportSite({ results: exportable.slice(1), ...io, manifest: forExport() })

    expect(io.site.get('docs/index.rsc')).toBe('payload:docs')
    expect(io.site.get('docs/index.seg1.rsc')).toBe('from depth 1')
    expect(io.site.get('docs/index.seg2.rsc')).toBe('from depth 2')
  })

  test('says so when the output it was told about is not there', async () => {
    // The results and the output disagree — a build half-cleaned, or two runs
    // pointed at different directories. Writing a site with holes it does not
    // know about is worse than stopping.
    const io = inMemory([])

    await expect(
      exportSite({ results: exportable.slice(0, 1), ...io, manifest: forExport() }),
    ).rejects.toThrow(/Nothing to export/)
  })

  test('brings the browser bundle along when asked', async () => {
    const io = inMemory(['index'])
    let copied = false

    await exportSite({
      results: exportable.slice(0, 1),
      ...io,
      manifest: forExport(),
      assets: () => {
        copied = true
      },
    })

    expect(copied).toBe(true)
  })
})

describe('a frozen page and a request for less than one', () => {
  const withFrozen = (engine: unknown) =>
    createRscHandler({
      engine: engine as never,
      prerendered: prerenderedFrom(outDir),
    })

  test('a request naming a region is not answered with the whole page', async () => {
    // /static is frozen, so a whole-page payload is sitting right there. Handed
    // back for a revalidate request, the client puts an entire page inside the
    // named region.
    const res = await withFrozen(engine)(
      new Request('http://x/static', {
        headers: { 'X-RSC': '1', 'X-RSC-Revalidate': 'modal' },
      }),
    )

    expect(res?.headers.get('X-RSC-Revalidate')).toBe('modal')
    expect(res?.headers.get('X-RSC-Segment-Depth')).toBeNull()
  }, 20_000)
})

describe('a frozen page and an interception', () => {
  test('an intercepted request is not answered with the frozen page', async () => {
    // The modal would be replaced by the whole page it was opening over.
    const handle = createRscHandler({
      engine,
      prerendered: prerenderedFrom(outDir),
      manifest: {
        ...engine.manifest(),
        intercepts: [
          {
            component: 'app/@modal/(.)photo/[id]/page',
            slot: 'modal',
            segments: [
              { type: 'static', value: 'static' },
            ],
            marker: '(.)',
          },
        ],
      },
    })

    const res = await handle(
      new Request('http://x/static', {
        headers: { 'X-RSC': '1', 'X-RSC-Intercept': 'modal', 'X-RSC-Referer': '/feed' },
      }),
    )

    expect(res?.headers.get('X-RSC-Revalidate')).toBe('modal')
  }, 20_000)
})
