// createTestApp builds with the project's own build script, on the runtime
// the tests run under. It used to run `npx vite build` whatever package.json
// said - on a Bun project that built under Node and failed at the first
// `import 'bun'`, in the one place the guide promised "your own build".
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCommand } from '../../src/testing'

const project = (pkg: unknown) => {
  const root = mkdtempSync(join(tmpdir(), 'rsc-build-cmd-'))
  if (pkg !== null) writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
  return root
}

describe('the build createTestApp runs', () => {
  // These tests run under Bun, so the runtime half of the decision is Bun's.
  test('is the project\'s own build script, through the package manager of the runtime', () => {
    expect(buildCommand(project({ scripts: { build: 'bun --bun vite build' } }))).toEqual(['bun', ['run', 'build']])
  })

  test('without a script, is Vite on the runtime the tests use', () => {
    expect(buildCommand(project({ scripts: {} }))).toEqual(['bun', ['--bun', 'vite', 'build']])
    expect(buildCommand(project(null))).toEqual(['bun', ['--bun', 'vite', 'build']])
  })
})
