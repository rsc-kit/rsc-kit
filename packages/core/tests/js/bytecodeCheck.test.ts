/**
 * Naming what keeps --bytecode from applying.
 *
 * Bun compiles bytecode as CommonJS, lowers four import.meta forms, fails the
 * rest - and reports the failure without a file and with exit 0. A port shipped
 * green and died at boot. The build says which module and which line.
 */

import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bytecodeBlockers, bytecodeNote, unlowerableImportMeta } from '../../src/bytecodeCheck'

describe('what bytecode cannot express', () => {
  test('the forms Bun lowers pass, the rest are named with their line', () => {
    const source = [
      'globalThis.__nitro_main__ = import.meta.url;',
      'const dir = import.meta.dirname, d2 = import.meta.dir, m = import.meta.main;',
      '// import.meta.env in a comment is nothing',
      'const dev = import.meta.env?.DEV;',
      'const here = import.meta.filename;',
      'const r = import.meta.resolve("x");',
      'const meta = import.meta;',
    ].join('\n')

    expect(unlowerableImportMeta(source)).toEqual([
      { line: 4, form: 'import.meta.env' },
      { line: 5, form: 'import.meta.filename' },
      { line: 6, form: 'import.meta.resolve' },
      { line: 7, form: 'import.meta' },
    ])
  })

  test('the server output is scanned, the stored pages and node_modules left out', () => {
    const server = mkdtempSync(join(tmpdir(), 'bytecode-'))

    mkdirSync(join(server, '_ssr'))
    mkdirSync(join(server, 'node_modules/dep'), { recursive: true })
    writeFileSync(join(server, 'index.mjs'), 'globalThis.__nitro_main__ = import.meta.url;\n')
    writeFileSync(join(server, '_ssr/rsc.mjs'), 'ok();\nconst x = import.meta.env;\n')
    // A stored page whose text mentions import.meta - data, not code.
    writeFileSync(join(server, 'rsc-static-inline.mjs'), 'export default {"a.html":"<p>import.meta.env</p>"}\n')
    // Traced, not compiled from here.
    writeFileSync(join(server, 'node_modules/dep/index.js'), 'module.exports = import.meta.env\n')

    expect(bytecodeBlockers(server)).toEqual([{ file: '_ssr/rsc.mjs', line: 2, form: 'import.meta.env' }])

    const note = bytecodeNote(server)!

    expect(note).toContain('_ssr/rsc.mjs:2 uses import.meta.env')
    expect(note).toContain('exits 0')
    expect(note).toContain('--format=esm')

    writeFileSync(join(server, '_ssr/rsc.mjs'), 'ok();\n')

    expect(bytecodeNote(server)).toBeNull()

    rmSync(server, { recursive: true, force: true })
  })
})
