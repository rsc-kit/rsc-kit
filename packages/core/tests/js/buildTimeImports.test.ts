// The plugin is loaded by Node, from dist/, when an app runs `vite build`.
// Node's ESM resolver wants a file extension on every relative import, and
// Bun's does not - so a build-time module that omits it passes every test here
// and fails the first real `vite build`, which is how this was found.
//
// The modules the generated entry imports are the other way round: they are
// named without an extension on purpose (see "The Engine Ships Compiled").
// This reads only the ones the plugin itself imports, and what those import.

import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = join(import.meta.dir, '../../src')

/** The relative specifiers a module imports statically, as written. */
function relativeImports(file: string): string[] {
  return [...readFileSync(file, 'utf-8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)].map((m) => m[1]!)
}

/** Every module reachable from vite.ts by an import with an extension, and every import that has none. */
function walk(): { seen: Set<string>; wrong: string[] } {
  const seen = new Set<string>()
  const wrong: string[] = []
  const queue = ['vite.ts']

  while (queue.length) {
    const name = queue.shift()!

    if (seen.has(name)) continue

    seen.add(name)

    for (const specifier of relativeImports(join(src, name))) {
      if (!specifier.endsWith('.js')) {
        wrong.push(`${name} imports ${specifier}`)

        continue
      }

      const next = specifier.slice(2).replace(/\.js$/, '.ts')

      if (existsSync(join(src, next))) queue.push(next)
    }
  }

  return { seen, wrong }
}

test('every module the plugin loads under Node is imported with its extension', () => {
  const { seen, wrong } = walk()

  expect(seen.size).toBeGreaterThan(5)
  expect(seen.has('commandFiles.ts'), 'the walk reaches the commands build module').toBe(true)
  expect(wrong, 'a relative import without .js fails under Node: ' + wrong.join('; ')).toEqual([])
})
