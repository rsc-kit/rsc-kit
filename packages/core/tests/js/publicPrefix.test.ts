import { describe, expect, test } from 'bun:test'
import { publicPrefixReads } from '../../src/vite'

describe('import.meta.env.PUBLIC_* is refused by name', () => {
  // PUBLIC_ was a client prefix beside VITE_; dropped silently, every read of
  // one compiles to undefined in the browser with nothing said.
  test('names each PUBLIC_ variable a file reads, once', () => {
    const code = `
      const id = import.meta.env.PUBLIC_META_PIXEL_ID
      const url = import.meta.env.PUBLIC_APP_URL ?? import.meta.env.PUBLIC_APP_URL
    `

    expect(publicPrefixReads(code)).toEqual(['PUBLIC_META_PIXEL_ID', 'PUBLIC_APP_URL'])
  })

  test('leaves VITE_ reads and server reads of process.env.PUBLIC_* alone', () => {
    const code = `
      const key = import.meta.env.VITE_STRIPE_KEY
      const url = process.env.PUBLIC_APP_URL
      const mode = import.meta.env.MODE
    `

    expect(publicPrefixReads(code)).toEqual([])
  })
})

describe('a PUBLIC_ variable that is still set is refused by name', () => {
  // Most apps read client variables through a validated env object, so no
  // source scan sees the read; the variable being set is the signal.
  const { publicVariablesSet } = require('../../src/vite') as typeof import('../../src/vite')
  const { mkdtempSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  const { tmpdir } = require('node:os') as typeof import('node:os')

  test('names each one with the file and line that sets it, and the environment for the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'public-env-'))

    writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgres://x\nPUBLIC_APP_URL=https://a.test\n')
    writeFileSync(join(dir, '.env.production'), '# a comment\nexport PUBLIC_CDN_URL=https://cdn.test\n')

    expect(publicVariablesSet('production', dir, { PUBLIC_CLARITY_ID: 'abc', PUBLIC_APP_URL: 'dup', HOME: '/x' })).toEqual([
      { name: 'PUBLIC_APP_URL', where: join(dir, '.env') + ':2' },
      { name: 'PUBLIC_CDN_URL', where: join(dir, '.env.production') + ':2' },
      { name: 'PUBLIC_CLARITY_ID', where: 'the environment' },
    ])
  })

  test('nothing to say for an app on VITE_', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vite-env-'))

    writeFileSync(join(dir, '.env'), 'VITE_APP_URL=https://a.test\nSECRET=x\n')

    expect(publicVariablesSet('production', dir, { VITE_CDN_URL: 'x' })).toEqual([])
  })
})
