// A dependency that imports react without declaring it as a peer is one
// plugin-rsc leaves external, and a "use client" inside it is then a string
// nobody reads. The detector finds those packages so the plugin can bundle
// them; these check it finds the right ones and leaves the rest alone.

import { describe, expect, test, beforeAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { clientPackages, hasClientDirective, packageDir } from '../../src/clientPackages'

let root: string

function pkg(name: string, manifest: object, files: Record<string, string>) {
  const dir = join(root, 'node_modules', name)

  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }))

  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), body)
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'client-packages-'))

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'app',
      dependencies: {
        react: '^19.2.0',
        '@acme/wrapper': '1.0.0',
        '@acme/ui': '1.0.0',
        '@acme/server-only': '1.0.0',
        '@acme/mentions-it': '1.0.0',
        '@acme/missing': '1.0.0',
      },
      devDependencies: { '@acme/dev-wrapper': '1.0.0' },
    }),
  )

  // The case that started this: a generated wrapper that imports react, says
  // nothing about it, and puts the directive in a re-exported file rather
  // than the entry.
  pkg('@acme/wrapper', { dependencies: { '@acme/core': '1.0.0', '@acme/runtime': '1.0.0' } }, {
    'dist/index.js': "export * from './components.js'\n",
    'dist/components.js': "/* licence */\n// generated\n'use client';\nimport React from 'react'\nexport const X = () => null\n",
  })

  // The runtime the wrapper calls into: react as a peer, and never reached
  // by plugin-rsc's crawl because the wrapper above it declared nothing.
  // Its own React-using dependency comes along; its plain one does not.
  pkg('@acme/runtime', { peerDependencies: { react: '*' }, dependencies: { '@acme/lit-bridge': '1.0.0', '@acme/parser': '1.0.0' } }, {
    'index.js': "import { useRef } from 'react'\nexport const create = () => useRef\n",
  })
  pkg('@acme/lit-bridge', { dependencies: { react: '*' } }, { 'index.js': "import React from 'react'\n" })
  pkg('@acme/parser', {}, { 'index.js': 'export const parse = () => 1\n' })
  pkg('@acme/core', {}, { 'index.js': 'export const core = 1\n' })

  // A library written for React: react as a peer, plugin-rsc bundles it.
  pkg('@acme/ui', { peerDependencies: { react: '*' } }, {
    'index.js': "'use client'\nexport const Button = () => null\n",
  })

  // No directive anywhere: external is right.
  pkg('@acme/server-only', {}, { 'index.js': 'export const answer = 42\n' })

  // The words in a string, not as a directive.
  pkg('@acme/mentions-it', {}, {
    'index.js': "export const note = 'a file starting with \"use client\" is a client file'\n",
    'lib/late.js': "const x = 1\n'use client'\nexport { x }\n",
  })

  pkg('@acme/dev-wrapper', {}, { 'index.js': "'use client'\nexport const Y = () => null\n" })
})

describe('the directive', () => {
  test('is found at the top of a file, after comments', () => {
    expect(hasClientDirective(join(root, 'node_modules/@acme/wrapper'))).toBe(true)
  })

  test('is not found in a string, or after code', () => {
    expect(hasClientDirective(join(root, 'node_modules/@acme/mentions-it'))).toBe(false)
  })
})

describe('which dependencies are bundled', () => {
  test('one with a directive and no react peer, and the React-using dependencies under it', () => {
    // The wrapper, the runtime it calls into, and the runtime's React-using
    // dependency - one React copy for all three. The plain dependencies
    // stay external.
    expect(clientPackages(root)).toEqual(['@acme/lit-bridge', '@acme/runtime', '@acme/wrapper'])
  })

  test('not one that declares react as a peer - plugin-rsc has it', () => {
    expect(clientPackages(root)).not.toContain('@acme/ui')
  })

  test('not one with no directive, one that is not installed, or a devDependency', () => {
    const found = clientPackages(root)

    expect(found).not.toContain('@acme/server-only')
    expect(found).not.toContain('@acme/missing')
    expect(found).not.toContain('@acme/dev-wrapper')
  })

  test('a project with no package.json has none', () => {
    expect(clientPackages(mkdtempSync(join(tmpdir(), 'empty-')))).toEqual([])
  })
})

describe('where a package is', () => {
  test('is resolved upward, the way node resolves', () => {
    const nested = join(root, 'apps', 'web')

    mkdirSync(nested, { recursive: true })
    expect(packageDir('@acme/ui', nested)).toBe(join(root, 'node_modules/@acme/ui'))
    expect(packageDir('@acme/nowhere', nested)).toBeNull()
  })
})
