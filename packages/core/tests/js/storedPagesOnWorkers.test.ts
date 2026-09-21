/**
 * Stored pages on Workers ride the static assets, not the bundle.
 *
 * An inline module counts against the script's size limit: a port's 571
 * stored category pages came to 69 MB of one, against a limit of 10. So on
 * a Cloudflare preset the build copies them among the public assets, under
 * a prefix the Worker answers first, and the server reads them back through
 * the ASSETS binding.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ASSETS_PREFIX, assetsReader, storedPagesToAssets } from '../../src/files'

let dir: string | null = null

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('reading through the assets binding', () => {
  const store: Record<string, string> = {
    '/_rsc-static/index.html': '<html>home',
    '/_rsc-static/products/_category_.ppr.html': '<html>shell',
    '/_rsc-static/a%20b.html': '<html>spaced',
  }
  let fetched: string[] = []
  const assets = {
    async fetch(input: Request | string) {
      const url = new URL(typeof input === 'string' ? input : input.url)

      fetched.push(url.pathname)

      const body = store[url.pathname]

      return body === undefined ? new Response('not found', { status: 404 }) : new Response(body)
    },
  }

  test('answers a stored file by its name under the prefix, and null for one that is not there', async () => {
    fetched = []
    const read = assetsReader(assets, '/_rsc-static')

    expect(await read('index.html')).toBe('<html>home')
    expect(await read('products/_category_.ppr.html')).toBe('<html>shell')
    expect(await read('products/nowhere.ppr.html')).toBeNull()
  })

  test('escapes each segment of a name', async () => {
    const read = assetsReader(assets, '/_rsc-static')

    expect(await read('a b.html')).toBe('<html>spaced')
  })

  test('asks the binding once per name, misses included', async () => {
    // The host asks three names per request, most of them misses, and the
    // binding is a fetch: the disk reader lists once, this remembers once.
    fetched = []
    const read = assetsReader(assets, '/_rsc-static')

    await read('index.html')
    await read('index.html')
    await read('missing.html')
    await read('missing.html')

    expect(fetched).toEqual(['/_rsc-static/index.html', '/_rsc-static/missing.html'])
  })
})

describe('the build on a Cloudflare preset', () => {
  test('copies the stored pages under the prefix and has the Worker answer it first', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rsc-workers-'))
    const staticDir = join(dir, 'server', 'rsc-static')
    const publicDir = join(dir, 'public')
    const wrangler = join(dir, 'server', 'wrangler.json')

    mkdirSync(join(staticDir, 'products'), { recursive: true })
    mkdirSync(publicDir, { recursive: true })
    writeFileSync(join(staticDir, 'index.html'), '<html>home')
    writeFileSync(join(staticDir, 'products', '_category_.ppr.html'), '<html>shell')
    writeFileSync(join(staticDir, 'products', '_category_.postponed.json'), '{}')
    writeFileSync(
      wrangler,
      JSON.stringify({ main: 'index.mjs', assets: { binding: 'ASSETS', directory: '../public' }, name: 'app' }),
    )

    const copied = await storedPagesToAssets(staticDir, publicDir, wrangler)

    expect(copied).toBe(3)
    expect(ASSETS_PREFIX('rsc-static')).toBe('_rsc-static')
    // Moved: wrangler would upload every .html left beside the bundle as a
    // text module, against the script's size limit.
    expect(existsSync(staticDir)).toBe(false)
    expect(readFileSync(join(publicDir, '_rsc-static', 'index.html'), 'utf-8')).toBe('<html>home')
    expect(readFileSync(join(publicDir, '_rsc-static', 'products', '_category_.ppr.html'), 'utf-8')).toBe('<html>shell')

    // A request for the prefix reaches the Worker, which has no such route,
    // rather than the asset: a stored page of a guarded route stays behind
    // the guard.
    const config = JSON.parse(readFileSync(wrangler, 'utf-8')) as { assets: { run_worker_first: string[] } }

    expect(config.assets.run_worker_first).toEqual(['/_rsc-static/*'])
  })

  test('keeps a run_worker_first the app already had', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rsc-workers-'))
    const staticDir = join(dir, 'server', 'rsc-static')
    const wrangler = join(dir, 'server', 'wrangler.json')

    mkdirSync(staticDir, { recursive: true })
    mkdirSync(join(dir, 'public'), { recursive: true })
    writeFileSync(join(staticDir, 'index.html'), 'x')
    writeFileSync(wrangler, JSON.stringify({ assets: { directory: '../public', run_worker_first: ['/api/*'] } }))

    await storedPagesToAssets(staticDir, join(dir, 'public'), wrangler)

    const config = JSON.parse(readFileSync(wrangler, 'utf-8')) as { assets: { run_worker_first: string[] } }

    expect(config.assets.run_worker_first).toEqual(['/api/*', '/_rsc-static/*'])
  })

  test('nothing stored, nothing copied, and the config is left alone', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rsc-workers-'))
    const wrangler = join(dir, 'wrangler.json')

    writeFileSync(wrangler, '{"assets":{"directory":"../public"}}')

    expect(await storedPagesToAssets(join(dir, 'rsc-static'), join(dir, 'public'), wrangler)).toBe(0)
    expect(readFileSync(wrangler, 'utf-8')).toBe('{"assets":{"directory":"../public"}}')
    expect(existsSync(join(dir, 'public', '_rsc-static'))).toBe(false)
  })
})
