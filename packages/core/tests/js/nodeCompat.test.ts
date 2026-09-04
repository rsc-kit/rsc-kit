import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ENGINE_DIR = join(import.meta.dir, '../../src')

/** Source lines with comments and strings stripped, so mentions in prose pass. */
function codeLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) =>
      line
        .replace(/\/\*.*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .replace(/^\s*\*.*$/, ''),
    )
}

describe('node compatibility', () => {
  test('the engine does not use Bun-only import.meta.dir', () => {
    // Vite bundles a project's config and runs it under Node, where
    // import.meta.dir is undefined — so a path resolved from it throws
    // ERR_INVALID_ARG_TYPE before the build starts. This suite runs under Bun,
    // where the same code works, so nothing else here would catch it.
    //
    // It is reached whenever RSC_PACKAGE_DIR is unset: the ordinary case for an
    // app that installs the engine from npm and runs `vite build` itself, and
    // never the case when a host drives the build and passes the path.
    const offenders: string[] = []

    for (const name of readdirSync(ENGINE_DIR)) {
      if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue

      for (const [i, line] of codeLines(join(ENGINE_DIR, name)).entries()) {
        if (line.includes('import.meta.dir')) offenders.push(`${name}:${i + 1}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
