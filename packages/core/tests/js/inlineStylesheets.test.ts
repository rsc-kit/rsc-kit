import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { smallStylesheetReader } from '../../src/vite'

// A small sheet, and one that stays large even gzipped.
function assets() {
  const dir = mkdtempSync(join(tmpdir(), 'css-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'small.css'), 'body{color:red}')
  writeFileSync(
    join(dir, 'assets', 'big.css'),
    Array.from({ length: 4000 }, (_, i) => `.c${i}{--v:${Math.random()}}`).join('\n'),
  )
  return dir
}

describe('which stylesheets are inlined', () => {
  test('auto takes the small one and leaves the big one', () => {
    const read = smallStylesheetReader(assets(), 'auto')

    expect(read('/assets/small.css')).toBe('body{color:red}')
    expect(read('/assets/big.css')).toBeNull()
  })

  test('true takes both, whatever the size', () => {
    const read = smallStylesheetReader(assets(), true)

    expect(read('/assets/big.css')).not.toBeNull()
  })

  test('a number is a cap in gzipped bytes', () => {
    const read = smallStylesheetReader(assets(), 8)

    expect(read('/assets/small.css')).toBeNull()
    expect(smallStylesheetReader(assets(), 1_000_000)('/assets/big.css')).not.toBeNull()
  })

  test('refuses anything not under the assets it was given', () => {
    const read = smallStylesheetReader(assets(), true)

    expect(read('https://elsewhere.example/x.css')).toBeNull()
    expect(read('/assets/../../etc/passwd')).toBeNull()
    expect(read('/assets/missing.css')).toBeNull()
  })
})
