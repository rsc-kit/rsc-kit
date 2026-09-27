/**
 * How the generated entry imports instrumentation.ts.
 *
 * The entry reads both hooks - register() at startup, shutdown() for the
 * shutdown plugin - but a file may export either, both or neither. Read off a
 * namespace import, a hook the file does not export is a bundler warning on
 * every build (IMPORT_IS_UNDEFINED: "Import `shutdown` will always be
 * undefined"), which is the app told off for a file written as documented.
 * So only the hooks the file exports are named; the rest are undefined here.
 */
import { describe, expect, test } from 'bun:test'
import { instrumentationImport } from '../../src/vite'

const file = '/app/src/instrumentation.ts'
const named = (code: string, hook: string) => new RegExp(`\\b${hook}\\b`).test(code.split('\n').find((l) => l.startsWith('import')) ?? '')

describe('the entry names only the hooks instrumentation.ts exports', () => {
  test('register() only: shutdown is never read from the file', () => {
    const code = instrumentationImport({ file, hasRegister: true, hasShutdown: false })

    expect(code).not.toContain('import * as')
    expect(named(code, 'register')).toBe(true)
    expect(named(code, 'shutdown')).toBe(false)
  })

  test('shutdown() only: register is never read from the file', () => {
    const code = instrumentationImport({ file, hasRegister: false, hasShutdown: true })

    expect(code).not.toContain('import * as')
    expect(named(code, 'shutdown')).toBe(true)
    expect(named(code, 'register')).toBe(false)
  })

  test('both: both are named', () => {
    const code = instrumentationImport({ file, hasRegister: true, hasShutdown: true })

    expect(named(code, 'register')).toBe(true)
    expect(named(code, 'shutdown')).toBe(true)
  })

  test('neither: the file is still imported, first, for its side effects', () => {
    const code = instrumentationImport({ file, hasRegister: false, hasShutdown: false })

    expect(code.split('\n')[0]).toBe(`import ${JSON.stringify(file)}`)
  })

  test('no file: an empty object, and nothing imported', () => {
    expect(instrumentationImport(null)).not.toContain('import')
  })

  test('whatever the file exports, __instrumentation has both hooks to read', () => {
    for (const [hasRegister, hasShutdown] of [[true, false], [false, true], [true, true], [false, false]]) {
      expect(instrumentationImport({ file, hasRegister, hasShutdown })).toContain('__instrumentation')
    }
  })
})
