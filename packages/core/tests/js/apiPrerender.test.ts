// Freezing an api route the way a page is frozen.
//
// The question these answer is not "does the probe work" but "does it get the
// call right": a route that reads the request must never be stored, because a
// stored answer to a personal question is one caller's answer served to
// everyone. So the fixtures are one of each and the assertions are about which
// bucket they land in.

import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apiKey, prerenderApiRoutes } from '../../src/apiPrerender'
import { writeTo, prerenderedFrom } from '../../src/files'
import { createRscHandler } from '../../src/host'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('apiPrerender.test.ts')

let engine: any
let out: string
let results: Awaited<ReturnType<typeof prerenderApiRoutes>>

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import('./goHost')

  await buildFixtureOnce()

  engine = await import(bundlePath)
  out = mkdtempSync(join(tmpdir(), 'api-prerender-'))
  results = await prerenderApiRoutes(engine, engine.manifest(), writeTo(out))
}, 300_000)

const resultFor = (url: string) => results.find((r) => r.url === url)

describe('which routes the build can answer', () => {
  test('one that reads nothing is stored', () => {
    expect(resultFor('/api/pricing')?.type).toBe('frozen')
    expect(existsSync(join(out, apiKey('/api/pricing')))).toBe(true)
  })

  test('and its status and headers are stored with it, not just the body', () => {
    const frozen = JSON.parse(readFileSync(join(out, apiKey('/api/pricing')), 'utf-8'))

    expect(frozen.status).toBe(200)
    expect(frozen.headers).toContainEqual(['x-fixture', 'pricing'])
    expect(JSON.parse(frozen.body)).toEqual({ tiers: ['free', 'pro'] })
  })

  test('one that reads the request is left alone, and says which read did it', () => {
    const result = resultFor('/api/whoami')

    expect(result?.type).toBe('dynamic')
    expect(result?.reason).toContain('headers')
    expect(existsSync(join(out, apiKey('/api/whoami')))).toBe(false)
  })

  test('one that reads the query off request.url is left alone, and told what to await', () => {
    // The Next way to read a query. The probe sees an awaited searchParams and
    // stores the bare answer as good for every query that route ignores - but
    // this route does not ignore it, it reads it where the probe cannot look.
    // A stored 403 here is the answer to every webhook handshake.
    const result = resultFor('/api/verify')

    expect(result?.type).toBe('dynamic')
    expect(result?.reason).toContain('url')
    expect(result?.reason).toContain('await searchParams')
    expect(existsSync(join(out, apiKey('/api/verify')))).toBe(false)
  })

  test('one that sets a cookie is left alone, whatever it read', () => {
    // A cookie is an answer for one visitor. Stored, the build's cookie would
    // be handed to everyone who asked.
    const result = resultFor('/api/visitor')

    expect(result?.type).toBe('dynamic')
    expect(result?.reason).toContain('cookie')
    expect(existsSync(join(out, apiKey('/api/visitor')))).toBe(false)
  })

  test('one that froze the clock is stored, and says so', () => {
    // The same footgun a page has, with no browser to move the value to.
    const result = resultFor('/api/now')

    expect(result?.type).toBe('frozen')
    expect(result?.warning).toContain('Date.now()')
  })

  test('a parameterised route is left alone, because its urls are not known', () => {
    // The page answer to this is generateStaticParams. Until a route can say
    // the same, one url cannot stand in for all of them.
    const result = results.find((r) => r.name.includes('items'))

    expect(result?.type).toBe('dynamic')
    expect(result?.reason).toContain('param')
  })

  test('a guarded route is never stored', () => {
    // Two locks on the same door: the build refuses to store one, and the host
    // refuses to serve a stored one. A guard that answers differently per
    // caller cannot have one answer kept for everybody.
    const guarded = results.find((r) => r.name.includes('host-guard'))

    if (guarded) expect(guarded.type).toBe('dynamic')
  })
})

describe('serving what was stored', () => {
  const handle = () =>
    createRscHandler({
      engine: { ...engine, manifest: engine.manifest },
      manifest: engine.manifest(),
      prerendered: prerenderedFrom(out),
    } as never)

  test('the stored answer is served, headers and all', async () => {
    const res = await handle()(new Request('https://app.test/api/pricing'))

    expect(res?.status).toBe(200)
    expect(res?.headers.get('X-Fixture')).toBe('pricing')
    expect(await res!.json()).toEqual({ tiers: ['free', 'pro'] })
  })

  test('a HEAD gets the headers without the body', async () => {
    const res = await handle()(new Request('https://app.test/api/pricing', { method: 'HEAD' }))

    expect(res?.status).toBe(200)
    expect(await res!.text()).toBe('')
  })

  test('a route that ignores the query is served from disk whatever is on the url', async () => {
    // The point of making searchParams awaitable rather than resolved. A route
    // that never reaches for it gives the same answer for every query — and
    // every ?utm_source= and ?fbclid= would otherwise miss the stored answer,
    // which is most of the links people actually follow.
    //
    // The stored file is overwritten with something the route would never
    // produce, so "served from disk" and "ran the route" are distinguishable —
    // otherwise both answer identically and this asserts nothing.
    const { writeFileSync } = await import('node:fs')

    writeFileSync(
      join(out, apiKey('/api/pricing')),
      JSON.stringify({
        status: 200,
        headers: [['x-fixture', 'from-disk']],
        body: '{}',
        varies: false,
      }),
    )

    for (const url of ['/api/pricing', '/api/pricing?utm_source=x&fbclid=y']) {
      expect((await handle()(new Request('https://app.test' + url)))?.headers.get('X-Fixture')).toBe(
        'from-disk',
      )
    }
  })

  test('but one that reads the query is only served for the bare url', async () => {
    expect(resultFor('/api/search')?.type).toBe('frozen')

    const bare = await handle()(new Request('https://app.test/api/search'))

    expect(await bare!.json()).toEqual({ q: 'nothing' })

    // Stored answers to /api/search?q=shoes would all be the one the build
    // happened to ask for, which is the bug this avoids.
    const asked = await handle()(new Request('https://app.test/api/search?q=shoes'))

    expect(await asked!.json()).toEqual({ q: 'shoes' })
  })

  test('and a file from a build that did not record this is treated as varying', async () => {
    // Serving an older file for every query would be guessing on the unsafe
    // side, so the absent field means "assume it matters".
    const { writeFileSync } = await import('node:fs')

    // /api/whoami is a real fixture route the build refused to store, so a
    // file appearing beside it is exactly the shape an older build would leave.
    writeFileSync(
      join(out, apiKey('/api/whoami')),
      JSON.stringify({ status: 200, headers: [['x-fixture', 'old-build']], body: '{}' }),
    )

    expect((await handle()(new Request('https://app.test/api/whoami')))?.headers.get('X-Fixture'))
      .toBe('old-build')
    expect((await handle()(new Request('https://app.test/api/whoami?x=1')))?.headers.get('X-Fixture'))
      .not.toBe('old-build')
  })

  test('a POST is never answered from disk', async () => {
    const res = await handle()(new Request('https://app.test/api/pricing', { method: 'POST' }))

    // No POST export, so 405 — the point is that it did not get the stored GET.
    expect(res?.status).toBe(405)
  })

  test('a route with nothing stored still runs', async () => {
    const res = await handle()(new Request('https://app.test/api/whoami'))

    expect(res?.status).toBe(200)
  })
})

describe('the stored file is the same bytes every build', () => {
  test('headers are lower-cased and sorted', async () => {
    // Headers iteration promises neither a case nor an order, and a file that
    // differs between builds for no reason defeats content-addressed caching
    // and makes a deploy diff unreadable. This caught a real difference
    // between running this file alone and running it in the suite.
    // Two fresh runs, not one against `out` — a test above overwrites that
    // file on purpose to prove the host reads from disk.
    const [a, b] = [
      mkdtempSync(join(tmpdir(), 'api-det-a-')),
      mkdtempSync(join(tmpdir(), 'api-det-b-')),
    ]

    await prerenderApiRoutes(engine, engine.manifest(), writeTo(a))
    await prerenderApiRoutes(engine, engine.manifest(), writeTo(b))

    const read = (dir: string) => readFileSync(join(dir, apiKey('/api/pricing')), 'utf-8')

    expect(read(a)).toBe(read(b))

    const frozen = JSON.parse(read(a))

    expect(frozen.headers.map(([name]: [string]) => name)).toEqual(['content-type', 'x-fixture'])
  })
})

describe('robots.txt, sitemap.xml and llms.txt from a file beside the root layout', () => {
  const handle = () =>
    createRscHandler({
      engine: { ...engine, manifest: engine.manifest },
      manifest: engine.manifest(),
      prerendered: prerenderedFrom(out),
    } as never)

  test('are api routes the build synthesised, with no guard on them', () => {
    const manifest = engine.manifest() as { apis: { name: string; segments: { type: string; value: string }[]; middleware: string[]; methods: string[] }[] }
    const sitemap = manifest.apis.find((a) => a.name === 'app/sitemap.xml/route')

    expect(sitemap).toMatchObject({ segments: [{ type: 'static', value: 'sitemap.xml' }], middleware: [], methods: ['GET'] })
    expect(manifest.apis.some((a) => a.name === 'app/robots.txt/route')).toBe(true)
    expect(manifest.apis.some((a) => a.name === 'app/llms.txt/route')).toBe(true)
  })

  test('read nothing per request, so the build stores them', () => {
    for (const url of ['/robots.txt', '/sitemap.xml', '/llms.txt']) {
      expect(resultFor(url)?.type).toBe('frozen')
      expect(existsSync(join(out, apiKey(url)))).toBe(true)
    }
  })

  test('and the stored answers are served as the crawler expects them', async () => {
    const robots = await handle()(new Request('https://app.test/robots.txt'))
    const sitemap = await handle()(new Request('https://app.test/sitemap.xml'))
    const llms = await handle()(new Request('https://app.test/llms.txt'))

    expect(robots?.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const robotsText = await robots!.text()
    expect(robotsText).toContain('User-Agent: *\nAllow: /\nDisallow: /api/\nDisallow: /guarded')
    expect(robotsText).toContain('User-Agent: GPTBot\nDisallow: /\nCrawl-delay: 10')
    expect(robotsText).toContain('Sitemap: https://fixture.test/sitemap.xml')
    expect(sitemap?.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(await sitemap!.text()).toContain('<loc>https://fixture.test/pricing?plan=a&amp;b</loc>')
    expect(await llms!.text()).toContain('# Fixture\n\n> A fixture app, described for a model.')
  })
})
