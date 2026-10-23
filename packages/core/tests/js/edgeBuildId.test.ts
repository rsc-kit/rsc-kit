/**
 * The edge contract's build is the stored pages', not the client's: a release that
 * changes only what the server renders into a shell must not keep the id an
 * edge checks its cached shells against.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { edgeBuildId, storedPayloadAssets } from '../../src/vite'

function stored(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'edge-build-'))

  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), contents)
  }

  return dir
}

const BUILD = {
  'dashboard.ppr.html': '<!DOCTYPE html><html><body><h1>Dashboard</h1>',
  'dashboard.postponed.json': '{"state":1}',
  'docs/_slug_.ppr.html': '<!DOCTYPE html><html><body><h1>Docs</h1>',
  'docs/_slug_.postponed.json': '{"state":2}',
  'about.html': '<html>About</html>',
}

describe('edgeBuildId', () => {
  test('the same shells and client give the same id', () => {
    expect(edgeBuildId('c1', stored(BUILD))).toBe(edgeBuildId('c1', stored(BUILD)))
  })

  test('a server-only change to a shell is a new id, the client id unchanged', () => {
    const changed = { ...BUILD, 'dashboard.ppr.html': '<!DOCTYPE html><html><body><h1>Overview</h1>' }

    expect(edgeBuildId('c1', stored(changed))).not.toBe(edgeBuildId('c1', stored(BUILD)))
  })

  test('so is a change to a postponed state alone, or a shell moved to another page', () => {
    const state = { ...BUILD, 'docs/_slug_.postponed.json': '{"state":3}' }
    const { 'docs/_slug_.ppr.html': html, 'docs/_slug_.postponed.json': json, ...rest } = BUILD
    const moved = { ...rest, 'guides/_slug_.ppr.html': html, 'guides/_slug_.postponed.json': json }

    expect(edgeBuildId('c1', stored(state))).not.toBe(edgeBuildId('c1', stored(BUILD)))
    expect(edgeBuildId('c1', stored(moved))).not.toBe(edgeBuildId('c1', stored(BUILD)))
  })

  test('and a client change is one too', () => {
    expect(edgeBuildId('c2', stored(BUILD))).not.toBe(edgeBuildId('c1', stored(BUILD)))
  })

  test('a whole page moves it too: an edge may hold it as a static page', () => {
    expect(edgeBuildId('c1', stored({ ...BUILD, 'about.html': '<html>Changed</html>' }))).not.toBe(edgeBuildId('c1', stored(BUILD)))
  })

  test('a stored payload alone does not: a static page names its own by hash, in its document', () => {
    expect(edgeBuildId('c1', stored({ ...BUILD, 'about.flight': 'changed' }))).toBe(edgeBuildId('c1', stored({ ...BUILD, 'about.flight': 'before' })))
  })

  test('fits the contract: 1-128 bytes of [A-Za-z0-9._-]', () => {
    expect(edgeBuildId('c1', stored(BUILD))).toMatch(/^[A-Za-z0-9._-]{1,128}$/)
  })
})

describe('storedPayloadAssets', () => {
  test('copies the payload to a hashed asset and names it in the document, with its layouts', () => {
    const dir = stored({
      'about.html': '<!DOCTYPE html><html><head><title>About</title></head><body>About</body></html>',
      'about.flight': '0:["$","p",null,{}]',
      'about.meta.json': JSON.stringify({ layouts: ['app/layout', 'app/(site)/layout'] }),
    })
    const client = mkdtempSync(join(tmpdir(), 'client-'))

    expect(storedPayloadAssets(dir, client, [{ path: '/about', key: 'about' }])).toEqual(['/about'])

    const html = readFileSync(join(dir, 'about.html'), 'utf8')
    const url = html.match(/<meta name="rsc-kit:payload" content="([^"]+)"/)![1]

    expect(url).toMatch(/^\/assets\/_rsc\/[0-9a-f]{16}\.rsc$/)
    expect(html).toContain(`<link rel="preload" as="fetch" crossorigin="" href="${url}"/>`)
    expect(html).toContain('data-layouts="app/layout,app/(site)/layout"')
    expect(html.indexOf(url)).toBeLessThan(html.indexOf('</head>'))
    expect(readFileSync(join(client, url), 'utf8')).toBe('0:["$","p",null,{}]')
  })

  test('a document with no head, or no payload, is not listed', () => {
    const dir = stored({ 'a.html': '<p>no head</p>', 'a.flight': 'x', 'a.meta.json': '{}', 'b.html': '<head></head>' })

    expect(storedPayloadAssets(dir, mkdtempSync(join(tmpdir(), 'client-')), [{ path: '/a', key: 'a' }, { path: '/b', key: 'b' }])).toEqual([])
  })
})
