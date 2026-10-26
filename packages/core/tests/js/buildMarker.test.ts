// The build marker names the app's own single-binary step, so a deploy runs
// what the app runs and never assumes a script name or an output path.

import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileRebuilds, compileStep } from '../../src/vite'

const dirs: string[] = []
const app = (scripts?: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'rsc-marker-'))

  dirs.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts }))

  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('names the compile script and the binary its --outfile writes', () => {
  expect(compileStep(app({ compile: 'vite build && bun build --compile .output/server/compile.mjs --outfile dist/app' }))).toEqual({
    compile: 'compile',
    binary: 'dist/app',
  })
  expect(compileStep(app({ compile: 'vite build && bun build --compile --splitting .output/server/compile.mjs --outfile dist/app' }))).toEqual({
    compile: 'compile',
    binary: 'dist/app',
  })
  expect(compileStep(app({ compile: 'bun build --compile x.mjs --outfile="build/my app"' }))).toEqual({
    compile: 'compile',
    binary: 'build/my app',
  })
})

test('names compile:binary when there is one, which compiles without building again', () => {
  // A deploy runs the build, then the step the marker names. compile builds
  // first, so naming it ran the whole Vite build twice on every deploy.
  const dir = app({
    compile: 'vite build && bun run compile:binary',
    'compile:binary': 'bun build --compile --splitting .output/server/compile.mjs --outfile dist/app',
  })

  expect(compileStep(dir)).toEqual({ compile: 'compile:binary', binary: 'dist/app' })
  expect(compileRebuilds(dir)).toBe(false)
})

test('a compile that builds, with no compile:binary, is said to build twice', () => {
  expect(compileRebuilds(app({ compile: 'bun --bun vite build && bun build --compile x.mjs --outfile dist/app' }))).toBe(true)
  expect(compileRebuilds(app({ compile: 'bun build --compile x.mjs --outfile dist/app' }))).toBe(false)
  expect(compileRebuilds(app({ build: 'vite build' }))).toBe(false)
})

test('an app with no compile script names none', () => {
  expect(compileStep(app({ build: 'vite build' }))).toEqual({})
  expect(compileStep(join(tmpdir(), 'no-such-app-' + Date.now()))).toEqual({})
})

// Before building: the app's own Vite config, evaluated the way a build
// evaluates it, so RSC_OUTPUT and a computed value resolve as the build would.
test('rsc-kit info reads what a build will produce, without building', async () => {
  const { appInfo } = await import('../../src/typegen')
  const example = join(import.meta.dir, '../../../../examples/app')

  expect(await appInfo(example)).toMatchObject({ output: 'server', compile: 'compile', binary: 'rsc-app' })
}, 60_000)
