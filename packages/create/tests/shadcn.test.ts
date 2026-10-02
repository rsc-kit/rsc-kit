import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markRsc } from '../src/shadcn'
import { parseArgs } from '../src/options'

describe('--shadcn', () => {
  test('is a flag', () => {
    expect(parseArgs(['my-app', '--shadcn']).shadcn).toBe(true)
  })

  test('marks the app RSC after shadcn\'s init, keeping the rest of its config', () => {
    // Its init sees plain Vite and writes false, and the components it adds
    // later then lack "use client".
    const path = join(mkdtempSync(join(tmpdir(), 'shadcn-')), 'components.json')

    writeFileSync(path, JSON.stringify({ style: 'base-nova', rsc: false, aliases: { utils: '@/lib/utils' } }))

    expect(markRsc(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({
      style: 'base-nova',
      rsc: true,
      aliases: { utils: '@/lib/utils' },
    })
  })

  test('and says so when there is nothing to mark', () => {
    expect(markRsc(join(tmpdir(), 'no-such-dir-for-shadcn', 'components.json'))).toBe(false)
  })
})
