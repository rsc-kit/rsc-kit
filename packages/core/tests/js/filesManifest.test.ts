import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filesManifest, ruleMatches } from '../../src/filesManifest'

const dir = mkdtempSync(join(tmpdir(), 'files-manifest-'))

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
})
