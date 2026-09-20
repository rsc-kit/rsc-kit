// The frozen pages inside a compiled binary.

import { describe, expect, test } from 'bun:test'


describe('the entry a binary is compiled from', () => {
  test('imports the pages by name, hands them over, then starts the server', async () => {
    // Bun embeds what is imported by name and nothing a computed import
    // names; this is what puts the frozen pages inside the binary.
    const { compileEntrySource, EMBEDDED_PAGES, prerenderedBeside } = await import('../../src/files')
    const source = compileEntrySource('rsc-static')

    expect(source).toContain('import pages from "./rsc-static-inline.mjs"')
    expect(source.indexOf('Symbol.for("rsc-kit.embedded-pages")')).toBeLessThan(source.indexOf('import("./index.mjs")'))

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
