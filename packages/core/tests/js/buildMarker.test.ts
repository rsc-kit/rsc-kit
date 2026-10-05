// The build marker names the app's own single-binary step, so a deploy runs
// what the app runs and never assumes a script name or an output path.

import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileStep } from '../../src/vite'

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
  expect(compileStep(app({ compile: 'bun build --compile x.mjs --outfile="build/my app"' }))).toEqual({
    compile: 'compile',
    binary: 'build/my app',
  })
})

test('an app with no compile script names none', () => {
  expect(compileStep(app({ build: 'vite build' }))).toEqual({})
  expect(compileStep(join(tmpdir(), 'no-such-app-' + Date.now()))).toEqual({})
})
