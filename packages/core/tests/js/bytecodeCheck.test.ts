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

describe('the note is said only to a project that compiles with --bytecode', () => {
  // vite build cannot know how its output will be compiled, and the note is
  // only true for a project that asks for bytecode. It printed on every bun
  // build: a port whose compile script is `bun build --compile --sourcemap`
  // read "--bytecode will not apply" on every deploy, about a flag it never
  // passed.
  const { bytecodeNoteFor, projectUsesBytecode } = require('../../src/bytecodeCheck') as typeof import('../../src/bytecodeCheck')
  const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  const { tmpdir } = require('node:os') as typeof import('node:os')

  const project = (scripts: Record<string, string>, dockerfile?: string) => {
    const root = mkdtempSync(join(tmpdir(), 'bytecode-project-'))
    const server = join(root, '.output', 'server', '_libs')

    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts }))
    if (dockerfile !== undefined) writeFileSync(join(root, 'Dockerfile'), dockerfile)
    mkdirSync(server, { recursive: true })
    writeFileSync(join(server, 'unpdf.mjs'), 'export const worker = import.meta.resolve("./worker.mjs")\n')

    return { root, serverDir: join(root, '.output', 'server') }
  }

  test('a compile script without --bytecode: nothing to say', () => {
    const { root, serverDir } = project({ compile: 'bun --bun vite build && bun build --compile --sourcemap .output/server/compile.mjs --outfile dist/app' })

    expect(projectUsesBytecode(root)).toBe(false)
    expect(bytecodeNoteFor(root, serverDir)).toBeNull()
  })

  test('a script with --bytecode: the blocker is named', () => {
    const { root, serverDir } = project({ compile: 'bun build --compile --bytecode .output/server/compile.mjs --outfile dist/app' })

    expect(projectUsesBytecode(root)).toBe(true)
    expect(bytecodeNoteFor(root, serverDir)).toContain('_libs/unpdf.mjs:1 uses import.meta.resolve')
  })

  test('--bytecode in a Dockerfile counts too', () => {
    const { root, serverDir } = project({ build: 'vite build' }, 'RUN bun build --compile --minify --bytecode .output/server/compile.mjs --outfile app\n')

    expect(bytecodeNoteFor(root, serverDir)).not.toBeNull()
  })

  test('--bytecode with --format=esm applies regardless: nothing to say', () => {
    const { root, serverDir } = project({ compile: 'bun build --compile --bytecode --format=esm .output/server/compile.mjs --outfile dist/app' })

    expect(projectUsesBytecode(root)).toBe(false)
    expect(bytecodeNoteFor(root, serverDir)).toBeNull()
  })
})
