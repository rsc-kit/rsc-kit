/**
 * What the plugin tells Nitro about the server it assembles.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rscKit } from '../../src/vite'

let root: string

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function setupWith(options: Record<string, unknown>) {
  root = mkdtempSync(join(tmpdir(), 'rsc-nitro-'))
  mkdirSync(join(root, 'src/app'), { recursive: true })
  writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')

  const plugins = rscKit({ projectRoot: root, sourceDir: join(root, 'src'), outDir: join(root, '.rsc-kit') }) as Array<{
    name?: string
    nitro?: { setup(nitro: unknown): void }
  }>
  const main = plugins.find((p) => p?.name === 'rsc-kit')!
  const nitro = {
    options: { dev: false, preset: 'bun', output: { serverDir: join(root, '.output/server') }, ...options },
    hooks: { hook() {} },
  }

  main.nitro!.setup(nitro)

  return nitro.options as Record<string, any>
}

describe('the names of functions survive the bundle', () => {
  test('keepNames is on, so a renamed component still says what it was', () => {
    // The pages were prerendered against Vite's server bundles, where a
    // dependency runs from node_modules under its own names; Nitro bundles
    // it into the server and renames on a collision, J to J2. React's
    // resume of a stored shell compares component names, and a renamed one
    // was "Expected the resume to render <J> ... instead it rendered <J2>"
    // on every request, the hole rendered in the browser instead.
    const options = setupWith({})

    expect(options.rollupConfig.output.keepNames).toBe(true)
  })

  test('and an app that set its own output options keeps them', () => {
    const options = setupWith({ rollupConfig: { output: { keepNames: false, banner: '// mine' }, treeshake: false } })

    expect(options.rollupConfig).toEqual({ output: { keepNames: false, banner: '// mine' }, treeshake: false })
  })
})

describe('the worker script', () => {
  test('is served with no-cache, so a browser never installs a previous deploy\'s list against a new server', () => {
    const options = setupWith({})

    expect(options.routeRules['/sw.js'].headers['cache-control']).toBe('no-cache')
  })

  test('and an app\'s own rule for it is kept', () => {
    const options = setupWith({ routeRules: { '/sw.js': { headers: { 'cache-control': 'max-age=60', 'x-mine': '1' } }, '/api/**': { cors: true } } })

    expect(options.routeRules['/sw.js'].headers).toEqual({ 'cache-control': 'max-age=60', 'x-mine': '1' })
    expect(options.routeRules['/api/**']).toEqual({ cors: true })
  })
})
