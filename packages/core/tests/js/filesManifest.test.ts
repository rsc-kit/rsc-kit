import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filesManifest, nitroRouteRules, ruleMatches } from '../../src/filesManifest'

const dir = mkdtempSync(join(tmpdir(), 'files-manifest-'))
// An app with Nitro installed, whose h3 matcher the build checks files against.
const app = join(import.meta.dir, '../../../../examples/app')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

function file(path: string) {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), 'x')
}

describe('filesManifest', () => {
  test('lists every file once, its precompressed siblings as encodings, and leaves out what is excluded', () => {
    for (const path of ['assets/app-1a2b3c4d.js', 'assets/app-1a2b3c4d.js.br', 'assets/app-1a2b3c4d.js.gz', 'sw.js', 'sw.js.zst', 'notes.txt.gz', 'favicon.ico', '_rsc_pages/index.html']) file(path)

    const manifest = filesManifest(dir, {
      '/assets/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      '/sw.js': { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
      '/dashboard/**': { headers: { 'x-page': '1' } },
      '/blog/:slug': { headers: { 'x-param': '1' } },
      '/old': { redirect: '/new' },
    }, { exclude: ['/_rsc_pages'] })

    expect(manifest.files).toEqual(['/assets/app-1a2b3c4d.js', '/favicon.ico', '/notes.txt.gz', '/sw.js'])
    expect(manifest.precompressed).toEqual(['br', 'gzip', 'zstd'])
    expect(manifest.headers).toEqual([
      { match: '/assets/**', headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      { match: '/sw.js', headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
    ])
    expect(manifest.middleware).toBe(false)
    expect(manifest.v).toBe(1)
  })

  test('a missing directory is no files, not an error', () => {
    expect(filesManifest(join(dir, 'nope'), undefined).files).toEqual([])
  })

  test('a rule matches exactly, or everything under a /** prefix at a segment boundary', () => {
    expect(ruleMatches('/assets/**', '/assets/a.js')).toBe(true)
    expect(ruleMatches('/assets/**', '/assetsx/a.js')).toBe(false)
    expect(ruleMatches('/sw.js', '/sw.js')).toBe(true)
    expect(ruleMatches('/sw.js', '/sw.js.br')).toBe(false)
  })

  describe('fails closed: a file the manifest cannot describe is left to the app', () => {
    const rules = (routeRules: Record<string, unknown>) => routeRules

    function fixture(): string {
      const root = mkdtempSync(join(dir, 'closed-'))

      for (const path of ['assets/app-1a2b3c4d.js', 'sw.js', 'robots.txt', 'old.txt', 'api/spec.json', 'private/report.pdf', 'favicon.ico']) {
        mkdirSync(join(root, path, '..'), { recursive: true })
        writeFileSync(join(root, path), 'x')
      }

      return root
    }

    const routeRules = rules({
      '/**': { headers: { 'X-Frame-Options': 'DENY' } },
      '/assets/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      '/sw.js': { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
      '/:name.js': { headers: { 'x-script': '1' } },
      '/old.txt': { redirect: '/new.txt' },
      '/api/**': { cors: true },
      '/private/**': { headers: false },
    })

    test("by Nitro's own matcher", async () => {
      const resolve = await nitroRouteRules(app, routeRules, '')
      const why: Record<string, string> = {}

      expect(resolve).not.toBeNull()

      const manifest = filesManifest(fixture(), routeRules, { resolve, onLeftOut: (path, reason) => { why[path] = reason } })

      // /sw.js is under /:name.js, which a front cannot follow; /assets/app.js is not (one segment).
      expect(manifest.files).toEqual(['/assets/app-1a2b3c4d.js', '/favicon.ico', '/robots.txt'])
      expect(Object.keys(why).sort()).toEqual(['/api/spec.json', '/old.txt', '/private/report.pdf', '/sw.js'])
      expect(why['/old.txt']).toContain('redirect')
      expect(why['/api/spec.json']).toContain('cors')
      // Broadest first, so applying every match in turn is what Nitro merges.
      expect(manifest.headers).toEqual([
        { match: '/**', headers: { 'X-Frame-Options': 'DENY' } },
        { match: '/assets/**', headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      ])
    })

    test('by the literal prefix of a pattern, when the matcher cannot be loaded', () => {
      const manifest = filesManifest(fixture(), routeRules, { resolve: null })

      // /:name.js's literal prefix is /: everything goes to the app.
      expect(manifest.files).toEqual([])
      expect(filesManifest(fixture(), { '/assets/:file': { headers: { 'x-a': '1' } }, '/old.txt': { redirect: '/new.txt' } }).files)
        .toEqual(['/api/spec.json', '/favicon.ico', '/private/report.pdf', '/robots.txt', '/sw.js'])
    })

    test('a precedence the manifest would state wrongly is left out, not guessed', async () => {
      // An exact rule is more specific than /**, whichever order the app wrote them in.
      const routeRules = { '/sw.js': { headers: { 'cache-control': 'no-cache' } }, '/**': { headers: { 'cache-control': 'public' } } }
      const manifest = filesManifest(fixture(), routeRules, { resolve: await nitroRouteRules(app, routeRules, '') })

      expect(manifest.files).toContain('/sw.js')
      expect(manifest.headers.map((entry) => entry.match)).toEqual(['/**', '/sw.js'])
    })
  })

  test('paths are urls under the base url, rules matched there too', async () => {
    const root = mkdtempSync(join(dir, 'base-'))

    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets/a.js'), 'x')
    writeFileSync(join(root, 'naïve file.txt'), 'x')

    const routeRules = { '/assets/**': { headers: { 'cache-control': 'immutable' } } }
    const manifest = filesManifest(root, routeRules, { baseURL: '/docs/', resolve: await nitroRouteRules(app, routeRules, '/docs') })

    // Raw, as named on disk - a front decodes the request path before looking it up.
    expect(manifest.files).toEqual(['/docs/assets/a.js', '/docs/naïve file.txt'])
    expect(manifest.headers).toEqual([{ match: '/docs/assets/**', headers: { 'cache-control': 'immutable' } }])
  })
})
