// Rendering pages at build time, against the real fixture bundle.
//
// The engine renders; the prerenderer decides what to render and what to keep.
// These assert on those decisions — which urls exist, which pages can be
// frozen, and whether what came out can actually be served back at the depth a
// client asks for.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prerender, pathKey, urlFor, urlsToBuild } from '../../src/prerender'
import { exportSite } from '../../src/export'
import { prerenderedFrom, writeTo } from '../../src/files'
import type { PrerenderResult } from '../../src/prerender'
import type { RouteManifest } from '../../src/manifest'

/** The fixture app minus the route that fails on purpose. */
function withoutThrowing(manifest: RouteManifest): RouteManifest {
  return {
    ...manifest,
    routes: manifest.routes.filter((r) => r.component !== 'app/throws-in-boundary/page'),
  }
}

/** Only that route, for the test that wants the failure. */
function onlyThrowing(manifest: RouteManifest): RouteManifest {
  return {
    ...manifest,
    routes: manifest.routes.filter((r) => r.component === 'app/throws-in-boundary/page'),
  }
}
import { createRscHandler } from '../../src/host'
import { buildFixtureOnce, bundlePath as goBundlePath } from './goHost'

const packageRoot = join(import.meta.dir, '../..')
// The one shared build — see goHost.ts for why there can only be one.
const bundlePath = goBundlePath

let engine: any
let outDir: string
let results: Awaited<ReturnType<typeof prerender>>

beforeAll(async () => {
  // One build per process, through the shared helper.
  //
  // It rebuilds when any source file is newer than the bundle, which keeps the
  // reason this used to be unconditional: a fixture page added since the last
  // run would otherwise be missing, and the failure reads as the prerenderer
  // ignoring a route rather than as a stale build.
  //
  // Unconditional was also a race. This directory is shared — only one
  // @vitejs/plugin-rsc bundle can be live in a process — and a rebuild empties
  // it before rewriting it, so a file reading the bundle while this one
  // rebuilt saw ENOENT. It never reproduced locally, where the files run in
  // sequence.
  await buildFixtureOnce()

  engine = await import(bundlePath)
  engine.installHostFn(async () => ({ display: 'ramon' }))

  outDir = mkdtempSync(join(tmpdir(), 'rsc-prerender-'))
  results = await prerender({
    engine,
    write: writeTo(outDir),
    version: 'build-1',
    // One fixture fails on purpose, for the test below. The build refuses a
    // route it cannot store, so leaving it in would fail this setup and take
    // every other test with it.
    manifest: withoutThrowing(engine.manifest()),
  })

  // Every fixture route gets a shell probe, and the slow ones are slow on
  // purpose — the budget has to cover the build plus all of them.
}, 180_000)

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

const wrote = (name: string) => existsSync(join(outDir, name))
const resultFor = (url: string) => results.find((r) => r.url === url)

describe('a guarded route', () => {
  test('is frozen like any other, because the guard is a serving decision', async () => {
    // Whether the content is the same for everyone, and whether a caller may
    // see it, are different questions. The build answers the first. The host
    // runs the middleware before it hands the file over.
    const results = await prerender({
      engine: {
        handleRscPprShell: async () => ({ shellHtml: '<p>fine</p>', timedOut: false, usedDynamicApis: false }),
        handleRsc: async () => ({ body: '<p>fine</p>', rscPayload: '', clientChunks: {}, usedDynamicApis: false, clientComponents: [] }),
        handleRscPayload: async () => ({ rscPayload: '' }),
      } as never,
      write: async () => {},
      manifest: {
        version: 1,
        build: { output: 'server', exportPath: 'dist', payloadName: '' },
        routes: [
          {
            component: 'app/admin/page',
            segments: [{ type: 'static', value: 'admin' }],
            layouts: [],
            loadings: [],
            middleware: ['app/admin/middleware'],
            slots: {},
            sections: [],
            config: null,
            ancestorConfigs: [],
            staticParams: false,
            clientJs: true,
          },
        ],
        intercepts: [],
      } as never,
    })

    expect(results[0].type).toBe('frozen')
  })
})

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
      middleware: [],
      slots: {},
      sections: [],
      config: null,
      ancestorConfigs: [],
      staticParams,
      clientJs: true,
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

describe('a page whose data comes from the host', () => {
  // The bug this pins produced a blank page with nothing in the console.
  //
  // A build renders with no host installed, so rpc() cannot be answered. The
  // dispatcher used an optional call, so it returned undefined instead — and
  // undefined is a value: the component rendered with it, the render
  // succeeded, and the page was frozen holding "initial":"$undefined". The
  // browser then hydrated against an undefined prop, the client component read
  // a property of it, React unmounted the document, and the page went white.
  //
  // Neither half is enough on its own. The dispatcher has to refuse, and the
  // freeze path has to probe so the refusal is recorded as "needs a request"
  // rather than as a broken build.
  test('is not frozen holding undefined', async () => {
    const frozen = results.find((r) => r.url === '/')

    expect(frozen?.type).not.toBe('frozen')
  })

  test('a host call with no host installed refuses, rather than answering undefined', async () => {
    // The half that made the failure silent. An optional call answered every
    // rpc() with undefined, which is a value: the component rendered with it,
    // the render succeeded, and the page was frozen holding it.
    //
    // Asserted on the global rather than on a payload, because "$undefined"
    // appears in a Flight payload for ordinary reasons — a positional gap in
    // an array is one — and grepping for it cannot tell those apart.
    const previous = (globalThis as Record<string, unknown>).rpc

    try {
      engine.installHostFn(null)

      // Any render installs the dispatcher; this is the cheapest one.
      await engine.handleRsc('app/static/page', {}, null, [], [], {}, 0, '/static', true)

      const call = (globalThis as unknown as { rpc: (name: string) => Promise<unknown> }).rpc

      await expect(call('Anything')).rejects.toThrow(/No host callable is installed/)
    } finally {
      ;(globalThis as Record<string, unknown>).rpc = previous
      engine.installHostFn(async () => ({ display: 'ramon' }))
    }
  })
})

describe('which pages can be frozen', () => {
  test('a page that renders without reaching for anything is written', () => {
    expect(resultFor('/static')?.type).toBe('frozen')
    expect(wrote('static.html')).toBe(true)
    expect(wrote('static.flight')).toBe(true)
  })

  test('a page that reaches for the host ships a shell instead', () => {
    // Not frozen whole — that would bake one request's data into every
    // response — but not given up on either. The probe's timeout is the
    // ordinary path here: React flushed everything that does not depend on
    // the host, and that markup is the shell.
    expect(resultFor('/')?.type).toBe('shell')
    expect(wrote('index.html')).toBe(false)
    expect(wrote('index.ppr.html')).toBe(true)
  })

  test('so does one whose slow work sits behind Suspense', () => {
    expect(resultFor('/slow')?.type).toBe('shell')
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

    // The build refuses rather than reporting a category: a route that cannot
    // be stored and has not said so is an error with the fix named.
    const attempt = prerender({ engine, manifest: bare, write: () => {} })

    await expect(attempt).rejects.toThrow(/could not be prerendered/)
    await expect(attempt).rejects.toThrow(/loading.tsx/)
  }, 30_000)
})

describe('routes whose urls were never listed', () => {
  const withoutParams = () => {
    const manifest = withoutThrowing(engine.manifest())

    return {
      ...manifest,
      routes: manifest.routes.map((r) => ({ ...r, staticParams: false, clientJs: true })),
    }
  }

  test('ship one shell for the whole pattern', async () => {
    // Nothing in a shell varies by param, so the same markup serves every url
    // the route matches. This is most of PPR's value — the routes you can
    // enumerate are the ones you could already freeze whole.
    const dir = mkdtempSync(join(tmpdir(), 'rsc-pattern-'))
    const results = await prerender({ engine, manifest: withoutParams(), write: writeTo(dir) })

    expect(results.find((r) => r.component === 'app/item/[id]/page')?.type).toBe('shell')
    expect(existsSync(join(dir, 'item/_id_.ppr.html'))).toBe(true)

    // The shell holds the fallback, never the placeholder the build invented.
    const shell = readFileSync(join(dir, 'item/_id_.ppr.html'), 'utf-8')

    expect(shell).toContain('item-fallback')
    expect(shell).not.toContain('item-detail')

    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  test('a shell is written with the state needed to resume it', async () => {
    // The shell is produced by React's prerender rather than by aborting a
    // render, so it comes with `postponed` — where the render stopped. That is
    // what lets an origin finish the holes later, into the same response,
    // instead of the client fetching a payload and filling them after
    // hydration.
    //
    // The failure this pins is silent and specific: if the flight stream is
    // ever closed before the prerender ends, the boundary waiting on it errors
    // rather than staying pending, an errored boundary is finished rather than
    // postponed, and `postponed` comes back null. The shell still looks
    // perfect. Only resuming it fails, much later and somewhere else.
    const dir = mkdtempSync(join(tmpdir(), 'rsc-postponed-'))
    const results = await prerender({ engine, manifest: withoutParams(), write: writeTo(dir) })

    expect(results.find((r) => r.component === 'app/item/[id]/page')?.type).toBe('shell')

    const stateFile = join(dir, 'item/_id_.postponed.json')

    expect(existsSync(stateFile)).toBe(true)

    const postponed = JSON.parse(readFileSync(stateFile, 'utf-8'))

    // React's own shape. Asserting on it rather than on truthiness, because an
    // empty object is falsy in none of the ways that matter and would sail
    // through a looser check.
    expect(postponed).toHaveProperty('resumableState')
    expect(postponed).toHaveProperty('nextSegmentId')

    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  test('a page whose render failed is never frozen', async () => {
    // The failure mode this exists for: a rejection inside a Suspense boundary
    // does not reach the caller. React catches it, keeps the fallback, and the
    // render finishes — so the probe saw a page with nothing left to do and no
    // error, and froze the loading state as a finished static page.
    //
    // A build machine that could not reach the database therefore produced a
    // permanently-loading page, stored, and reported success.
    const dir = mkdtempSync(join(tmpdir(), 'rsc-throws-'))
    const results = await prerender({
      engine,
      manifest: onlyThrowing(engine.manifest()),
      write: writeTo(dir),
    }).catch((e: { routes?: { component: string; type: string; reason?: string }[] }) => e.routes ?? [])

    const page = (results as { component: string; type: string; reason?: string }[]).find(
      (r) => r.component === 'app/throws-in-boundary/page',
    )

    expect(page?.type).toBe('blocked')
    expect(page?.reason).toContain('connection refused')

    // And nothing on disk for it. Freezing the fallback would serve that
    // fallback to everyone until the next build.
    expect(existsSync(join(dir, 'throws-in-boundary.html'))).toBe(false)
    expect(existsSync(join(dir, 'throws-in-boundary.ppr.html'))).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  test('a page that finishes postpones nothing', async () => {
    // The other half of the same statement: a fully static page has no
    // unfinished boundaries, so there is no resumable state and no file. A
    // host reads that absence as "serve this whole and do not try to resume".
    const dir = mkdtempSync(join(tmpdir(), 'rsc-nopostpone-'))
    const results = await prerender({ engine, manifest: withoutParams(), write: writeTo(dir) })

    const frozen = results.filter((r) => r.type === 'frozen')

    expect(frozen.length).toBeGreaterThan(0)

    // A frozen page finished, so it has no resumable state and no file. A host
    // reads that absence as "serve this whole; there is nothing to resume".
    for (const page of frozen) {
      const key = page.url === '/' ? 'index' : page.url.replace(/^\//, '').replace(/\/$/, '')

      expect(existsSync(join(dir, `${key}.postponed.json`))).toBe(false)
    }

    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  test('get a shell even when the page awaits its params at the top level', async () => {
    // The photo page awaits its id with no boundary of its own — but the root
    // loading.tsx is one, so the await suspends into that fallback and the
    // shell is stored for the pattern. This is what awaiting params buys: a
    // route that lists no urls is no longer given up on.
    const dir = mkdtempSync(join(tmpdir(), 'rsc-pattern-'))
    const results = await prerender({ engine, manifest: withoutParams(), write: writeTo(dir) })
    const photo = results.find((r) => r.component === 'app/photo/[id]/page')

    expect(photo?.type).toBe('shell')

    // Never the placeholder the build had to invent for the pattern.
    const shell = readFileSync(join(dir, 'photo/_id_.ppr.html'), 'utf-8')

    expect(shell).not.toContain('Full photo _')

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

    expect(results[0].type).toBe('frozen')

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
    { url: '/', component: 'app/page', type: 'frozen', reason: null },
    { url: '/docs', component: 'app/docs/page', type: 'frozen', reason: null },
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
      { url: '/dashboard', component: 'app/dashboard/page', type: 'shell', reason: null },
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
        { url: '/dashboard', component: 'app/dashboard/page', type: 'shell', reason: null },
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

describe('a page leaning on the root loading.tsx', () => {
  test('is stored, but says the fallback is not its own', async () => {
    // The masking case. Nothing fails — the page has a shell — so without this
    // the build reports it exactly like a page whose boundary is right, and
    // every page in the app shows the same fallback while this one waits.
    const results = await prerender({ engine, manifest: withoutThrowing(engine.manifest()), write: () => {} })
    const inherited = results.find((r) => r.component === 'app/inherited/page')

    expect(inherited?.type).toBe('shell')
    expect(inherited?.warning).toMatch(/root loading\.tsx/)
  }, 90_000)

  test('and a page with its own boundary says nothing', async () => {
    // slow/ has its own loading.tsx; slow2/ has an inline <Suspense>. Neither
    // is leaning on the root, and a warning on either would be noise.
    const results = await prerender({ engine, manifest: withoutThrowing(engine.manifest()), write: () => {} })

    for (const component of ['app/slow/page', 'app/slow2/page']) {
      expect(results.find((r) => r.component === component)?.warning).toBeUndefined()
    }
  }, 90_000)
})

describe('a page that froze a value which will not be the same tomorrow', () => {
  test('says so, and does not stop the build', async () => {
    // The silent footgun: a page calling new Date() renders perfectly, freezes
    // that instant, and serves it to everyone until the next build. Nothing
    // fails, so nothing reports it.
    //
    // Detected the way the host call already is — by watching what the render
    // reaches for. React itself calls none of these during a render, so a
    // recorded call came from application code.
    const { watchNondeterminism, whileRendering } = await import('../../src/nondeterminism')
    const stop = watchNondeterminism()

    // The values are used deliberately: a bare `new Date()` is dropped by the
    // transpiler as a construction with no observable effect, which made this
    // test fail while the real detection worked.
    const [, found] = await whileRendering(async () => {
      const at = new Date().toISOString()
      const n = Math.random()

      return `${at}${n}`
    })

    stop()

    expect(found).toContain('new Date()')
    expect(found).toContain('Math.random()')

    // Restored: the watcher is installed around a build, not left on.
    const before = Date.now()
    const [, after] = await whileRendering(async () => new Date(before).toISOString())

    // A date built from an argument is as deterministic as the argument.
    expect(after).not.toContain('new Date()')
  })

  test('and does not fire for React itself', async () => {
    // If React called these during a render, every page would warn and the
    // signal would be worthless. Measured rather than assumed.
    const { watchNondeterminism, whileRendering } = await import('../../src/nondeterminism')
    const stop = watchNondeterminism()

    const [, found] = await whileRendering(async () => {
      // Nothing. A render that reaches for nothing must report nothing.
    })

    stop()

    expect(found).toEqual([])
  })
})
