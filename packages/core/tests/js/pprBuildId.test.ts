/**
 * The PPR contract's build is the shells', not the client's: a release that
 * changes only what the server renders into a shell must not keep the id an
 * edge checks its cached shells against.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pprBuildId } from '../../src/vite'

function stored(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ppr-build-'))

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

describe('pprBuildId', () => {
  test('the same shells and client give the same id', () => {
    expect(pprBuildId('c1', stored(BUILD))).toBe(pprBuildId('c1', stored(BUILD)))
  })

  test('a server-only change to a shell is a new id, the client id unchanged', () => {
    const changed = { ...BUILD, 'dashboard.ppr.html': '<!DOCTYPE html><html><body><h1>Overview</h1>' }

    expect(pprBuildId('c1', stored(changed))).not.toBe(pprBuildId('c1', stored(BUILD)))
  })

  test('so is a change to a postponed state alone, or a shell moved to another page', () => {
    const state = { ...BUILD, 'docs/_slug_.postponed.json': '{"state":3}' }
    const { 'docs/_slug_.ppr.html': html, 'docs/_slug_.postponed.json': json, ...rest } = BUILD
    const moved = { ...rest, 'guides/_slug_.ppr.html': html, 'guides/_slug_.postponed.json': json }

    expect(pprBuildId('c1', stored(state))).not.toBe(pprBuildId('c1', stored(BUILD)))
    expect(pprBuildId('c1', stored(moved))).not.toBe(pprBuildId('c1', stored(BUILD)))
  })

  test('and a client change is one too', () => {
    expect(pprBuildId('c2', stored(BUILD))).not.toBe(pprBuildId('c1', stored(BUILD)))
  })

  test('a page that is not a shell does not move it: no cached shell depends on it', () => {
    expect(pprBuildId('c1', stored({ ...BUILD, 'about.html': '<html>Changed</html>' }))).toBe(pprBuildId('c1', stored(BUILD)))
  })

  test('fits the contract: 1-128 bytes of [A-Za-z0-9._-]', () => {
    expect(pprBuildId('c1', stored(BUILD))).toMatch(/^[A-Za-z0-9._-]{1,128}$/)
  })
})
