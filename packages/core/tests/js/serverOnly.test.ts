/**
 * The engine's server-only modules stay out of the browser.
 *
 * A client component that imports a file which imports `redirect()` ships the
 * engine's request-scope code to every visitor, and the only trace was Vite
 * saying a Node builtin had been "externalized for browser compatibility". The
 * build now refuses it (rsc-kit:server-only). Two things hold that up here:
 * the table is right about what is server-only, and nothing a client may import
 * reaches any of it from inside the engine - the leak the build can only catch
 * in an app, caught where it would be introduced.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { SERVER_ONLY, serverOnlyEntry } from '../../src/vite'

const SRC = resolve(import.meta.dir, '../../src')
const PACKAGE = JSON.parse(readFileSync(join(SRC, '../package.json'), 'utf-8')) as { exports: Record<string, { default?: string } | string> }

describe('serverOnlyEntry', () => {
  test('names the entry an app imported, for the package\'s own files', () => {
    expect(serverOnlyEntry(join(SRC, 'redirect.js'), SRC)).toBe('redirect')
    expect(serverOnlyEntry(join(SRC, 'request.ts'), SRC)).toBe('request')
    expect(serverOnlyEntry(join(SRC, 'js/refreshOn.tsx'), SRC)).toBe('section')
    expect(serverOnlyEntry(join(SRC, 'hostCalls.mjs') + '?v=1', SRC)).toBe('host-calls')
  })

  test('and nothing else: not a client file, not an app file, not another package', () => {
    expect(serverOnlyEntry(join(SRC, 'js/Form.tsx'), SRC)).toBeNull()
    expect(serverOnlyEntry(join(SRC, 'notFound.ts'), SRC)).toBeNull()
    expect(serverOnlyEntry('/project/src/lib/redirect.ts', SRC)).toBeNull()
    expect(serverOnlyEntry('/project/node_modules/other/dist/request.js', SRC)).toBeNull()
  })
})

describe('the table', () => {
  test('lists real files, each reached through a real entry point', () => {
    for (const [file, entry] of Object.entries(SERVER_ONLY)) {
      const exists = ['.ts', '.tsx'].some((ext) => existsSync(join(SRC, file + ext)))

      expect(exists, `${file} is not a file under src`).toBe(true)
      expect(PACKAGE.exports[`./${entry}`], `./${entry} is not an entry point`).toBeDefined()
    }
  })

  test('covers every entry point that reaches a Node builtin or the request scope', () => {
    // What the audit found by walking the graph: these are the entry points that
    // cannot run in a browser. A new one that does is a new line in SERVER_ONLY.
    const served = new Set(Object.values(SERVER_ONLY))

    for (const entry of ['request', 'redirect', 'revalidate', 'cache', 'section', 'host', 'host-calls', 'prerender', 'export', 'files', 'build', 'runtime', 'embed', 'typegen', 'conformance', 'testing', 'vite']) {
      expect(served.has(entry), `./${entry} is server-only and not in SERVER_ONLY`).toBe(true)
    }
  })
})

// Every module reachable from an entry point a client component may import.
function reach(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length) {
    const file = queue.shift()!

    if (seen.has(file)) continue
    seen.add(file)

    const source = readFileSync(file, 'utf-8')

    // Type-only imports are erased; the rest, static or dynamic, are the graph.
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)(?!\s+type\b)[^;'"]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const spec = (match[1] ?? match[2] ?? match[3])!
      const base = resolve(dirname(file), spec.replace(/\.(c|m)?jsx?$/, ''))
      const found = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext).find(existsSync)

      if (found) queue.push(found)
    }
  }

  return seen
}

describe('what a client component may import', () => {
  const CLIENT = ['Form', 'useAction', 'Link', 'navigate', 'router', 'errors', 'usePathname', 'useSearchParams', 'useLinkStatus', 'useOnline', 'useOffline', 'useAppUpdate', 'useEvents', 'usePolling', 'useField', 'queryClient', 'PageTransition', 'RouteErrorBoundary', 'RedirectBoundary', 'form', 'client', 'not-found', 'routes', 'changed']

  for (const name of CLIENT) {
    test(`./${name} reaches nothing server-only`, () => {
      const target = PACKAGE.exports[`./${name}`]
      const dist = typeof target === 'string' ? target : target?.default ?? ''
      const file = ['.ts', '.tsx'].map((ext) => join(SRC, dist.replace(/^\.\/dist\//, '').replace(/\.js$/, '') + ext)).find(existsSync)

      expect(file, `no source for ./${name}`).toBeDefined()

      const leaked = [...reach(file!)].filter((module) => serverOnlyEntry(module, SRC) !== null)

      expect(leaked.map((module) => module.replace(SRC + '/', ''))).toEqual([])
    })
  }
})
