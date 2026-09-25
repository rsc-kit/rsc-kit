// The frozen pages inside a compiled binary.

import { describe, expect, test } from 'bun:test'


describe('the entry a binary is compiled from', () => {
  test('imports the pages by name, hands them over, then starts the server', async () => {
    // Bun embeds what is imported by name and nothing a computed import
    // names; this is what puts the frozen pages inside the binary.
    const { compileEntrySource, EMBEDDED_PAGES, prerenderedBeside } = await import('../../src/files')
    const source = compileEntrySource('rsc-static')


    // Static imports, inline module first: a module's imports evaluate in
    // order, so the pages are handed over (the inline module does that on
    // evaluation) before the server's first line runs. No top-level await -
    // it made Bun skip --bytecode for this entry, silently.
    expect(source).toContain('import "./rsc-static-inline.mjs"')
    expect(source.indexOf('import "./rsc-static-inline.mjs"')).toBeLessThan(source.indexOf('import "./index.mjs"'))
    const code = source.split('\n').filter((line) => !line.startsWith('//')).join('\n')

    expect(code).not.toContain('await')
    expect(code).not.toContain('import(')

    // And the reader takes what was handed over before looking anywhere.
    ;(globalThis as Record<symbol, unknown>)[EMBEDDED_PAGES] = { 'index.html': '<p>embedded</p>' }

    try {
      const read = prerenderedBeside('file:///nowhere/at/all/index.mjs', 'rsc-static')

      expect(await read('index.html')).toBe('<p>embedded</p>')
      expect(await read('missing.html')).toBeNull()
    } finally {
      delete (globalThis as Record<symbol, unknown>)[EMBEDDED_PAGES]
    }
  })
})
