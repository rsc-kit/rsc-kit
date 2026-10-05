// What a static export carries besides its pages: every file a server would
// have answered as a file, and the stored route.ts answers a static host can
// give as they were.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyPublic, exportStoredAnswers } from '../../src/files'

const dirs: string[] = []
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), 'rsc-export-files-'))

  dirs.push(d)

  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const stored = (at: string, name: string, answer: { status?: number; body: string; varies?: boolean; type?: string }) => {
  mkdirSync(join(at, ...name.split('/').slice(0, -1)), { recursive: true })
  writeFileSync(
    join(at, name + '.api.json'),
    JSON.stringify({ status: answer.status ?? 200, headers: [['content-type', answer.type ?? 'text/plain']], body: answer.body, varies: answer.varies ?? false }),
  )
}

describe('stored route answers', () => {
  test('are written as the files they are, at their urls', async () => {
    const from = dir()
    const to = dir()

    stored(from, 'robots.txt', { body: 'User-Agent: *\n' })
    stored(from, 'feeds/latest.json', { body: '{"items":[]}', type: 'application/json' })

    const { written, skipped } = await exportStoredAnswers(from, to)

    expect(written).toEqual(['/feeds/latest.json', '/robots.txt'])
    expect(skipped).toEqual([])
    expect(readFileSync(join(to, 'robots.txt'), 'utf-8')).toBe('User-Agent: *\n')
    expect(readFileSync(join(to, 'feeds/latest.json'), 'utf-8')).toBe('{"items":[]}')
  })

  test('one a static host cannot give as it was is said, not written', async () => {
    const from = dir()
    const to = dir()

    stored(from, 'api/health', { body: '{"ok":true}', type: 'application/json' })
    stored(from, 'moved.txt', { status: 301, body: '' })
    stored(from, 'per-visitor.txt', { body: 'x', varies: true })

    const { written, skipped } = await exportStoredAnswers(from, to)

    expect(written).toEqual([])
    expect(skipped.map((s) => s.url)).toEqual(['/api/health', '/moved.txt', '/per-visitor.txt'])
    expect(skipped[0]!.why).toContain('no extension')
    expect(existsSync(join(to, 'api/health'))).toBe(false)
  })

  test('nothing stored is nothing to write', async () => {
    expect(await exportStoredAnswers(join(dir(), 'missing'), dir())).toEqual({ written: [], skipped: [] })
  })
})

describe('the client output', () => {
  test('is copied whole: icons, manifest and service worker beside the bundle', async () => {
    const from = dir()
    const to = dir()

    mkdirSync(join(from, 'assets'))
    mkdirSync(join(from, '_app'))
    writeFileSync(join(from, 'assets/app.js'), 'js')
    writeFileSync(join(from, '_app/icon-192.png'), 'png')
    writeFileSync(join(from, 'manifest.webmanifest'), '{}')
    writeFileSync(join(from, 'sw.js'), 'sw')

    await copyPublic(from, to)()

    for (const file of ['assets/app.js', '_app/icon-192.png', 'manifest.webmanifest', 'sw.js']) {
      expect(existsSync(join(to, file))).toBe(true)
    }
  })
})
