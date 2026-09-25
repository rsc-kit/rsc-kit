import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inlineModuleName, inlineModuleSource, prerenderedBeside } from '../../src/files'

// Evaluating the inline module hands its pages to the process, for the
// binary's sake; between tests that is a page from the last layout showing
// up in the next.
afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('rsc-kit.embedded-pages')]
})

// The layout Nitro leaves: the bundle two levels down, the stored pages beside
// the server directory, and - since a Worker has no filesystem - the same
// pages once more as a module the bundle can import.
function layout() {
  const root = mkdtempSync(join(tmpdir(), 'beside-'))
  const server = join(root, 'server')

  mkdirSync(join(server, '_ssr'), { recursive: true })
  mkdirSync(join(server, 'rsc-static', 'posts'), { recursive: true })
  writeFileSync(join(server, 'rsc-static', 'orders.html'), '<p>orders</p>')
  writeFileSync(join(server, 'rsc-static', 'orders.flight'), '0:["$","p"]')
  writeFileSync(join(server, 'rsc-static', 'posts', 'hello.html'), '<p>hello</p>')

  return { root, server, bundleUrl: pathToFileURL(join(server, '_ssr', 'rsc.mjs')).href }
}

describe('finding the stored pages from the bundle', () => {
  test('walks up to the directory on a disk', async () => {
    const { bundleUrl } = layout()
    const read = prerenderedBeside(bundleUrl, 'rsc-static')

    expect(await read('orders.html')).toBe('<p>orders</p>')
    expect(await read('posts/hello.html')).toBe('<p>hello</p>')
    expect(await read('nope.html')).toBeNull()
  })

  test('falls back to the inline module when there is no directory', async () => {
    // What a Worker sees: the module wrangler uploaded, and no rsc-static/.
    const { server, bundleUrl } = layout()

    writeFileSync(join(server, inlineModuleName('rsc-static')), await inlineModuleSource(join(server, 'rsc-static')))

    const read = prerenderedBeside(bundleUrl, 'rsc-static', 4)
    // Take the directory away after the module was written from it.
    const { rmSync } = await import('node:fs')
    rmSync(join(server, 'rsc-static'), { recursive: true })

    expect(await read('orders.html')).toBe('<p>orders</p>')
    expect(await read('orders.flight')).toBe('0:["$","p"]')
    expect(await read('posts/hello.html')).toBe('<p>hello</p>')
    expect(await read('nope.html')).toBeNull()
  })

  test('is null for everything when neither exists', async () => {
    const read = prerenderedBeside(pathToFileURL('/nowhere/at/all/rsc.mjs').href, 'rsc-static')

    expect(await read('orders.html')).toBeNull()
  })

  test('the module is a default export of every file, by relative name', async () => {
    const { server } = layout()
    const source = await inlineModuleSource(join(server, 'rsc-static'))

    expect(source.startsWith('// @generated')).toBe(true)
    expect(source).toContain('"posts/hello.html":"<p>hello</p>"')
    expect(source).toContain('"orders.flight"')

    // And evaluating it hands the pages over: the binary's compile entry
    // imports it first for this, then the server.
    const { writeFileSync } = await import('node:fs')
    const path = join(server, inlineModuleName('rsc-static'))

    writeFileSync(path, source)

    const key = Symbol.for('rsc-kit.embedded-pages')

    try {
      const mod = (await import(path)) as { default: Record<string, string> }

      expect((globalThis as Record<symbol, unknown>)[key]).toBe(mod.default)
      expect(mod.default['orders.html']).toBe('<p>orders</p>')
    } finally {
      delete (globalThis as Record<symbol, unknown>)[key]
    }
  })
})

describe('what a stored page costs to serve', () => {
  test('is one read, then memory, for the life of the process', async () => {
    const { writeFileSync, rmSync } = await import('node:fs')
    const { server, bundleUrl } = layout()
    const read = prerenderedBeside(bundleUrl, 'rsc-static')

    expect(await read('orders.html')).toBe('<p>orders</p>')

    // Rewritten on disk, even removed: still served from memory. A build's
    // output does not change under a running server; a deploy restarts it.
    writeFileSync(join(server, 'rsc-static', 'orders.html'), '<p>orders v2</p>')
    expect(await read('orders.html')).toBe('<p>orders</p>')

    rmSync(join(server, 'rsc-static'), { recursive: true, force: true })
    expect(await read('orders.html')).toBe('<p>orders</p>')
  })
})
