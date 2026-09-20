// react-dom/server where server components render.
//
// Two ways it gets there: an app file imports it, and an app file imports a
// package that does. The first is answered with a module that throws the fix
// - before Vite's resolver, which would otherwise hand back React's
// react-server entry and fail the build on a missing export with no mention
// of the fix. The second is a dependency left external, whose own imports
// the build never resolves; the package is read once, and the build warns
// naming the app file and the package.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serverRendererInRsc } from '../../src/vite'

const root = mkdtempSync(join(tmpdir(), 'renderer-plugin-'))

function pkg(name: string, body: string) {
  const dir = join(root, 'node_modules', name)

  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'dist/index.js' }))
  writeFileSync(join(dir, 'dist/index.js'), body)

  return dir
}

pkg('@acme/email', 'const r = await import("react-dom/server");\nexport const render = (el) => r.renderToString(el)\n')
pkg('@acme/plain', 'export const answer = 42\n')

const app = join(root, 'src/actions.ts')

mkdirSync(join(root, 'src'), { recursive: true })
writeFileSync(app, '')

/** The hook, with the plugin context a build would give it. */
function run(source: string, importer: string, external: boolean) {
  const plugin = serverRendererInRsc() as any
  const warnings: string[] = []
  const ctx = {
    environment: { mode: 'build', name: 'rsc' },
    warn: (message: string) => warnings.push(message),
    resolve: async () => ({ id: join(root, 'node_modules', source, 'dist/index.js'), external }),
  }

  return plugin.resolveId.call(ctx, source, importer).then((id: unknown) => ({ id, warnings, plugin }))
}

describe('a direct import', () => {
  test('resolves to the stub, ahead of Vite', async () => {
    const { id, plugin } = await run('react-dom/server', app, false)

    expect(String(id)).toContain('rsc-kit:react-dom-server')
    expect(plugin.enforce).toBe('pre')
  })
})

describe('an external package that imports it', () => {
  test('is warned about once, naming the app file and the package', async () => {
    const first = await run('@acme/email', app, true)

    expect(first.id).toBeUndefined()
    expect(first.warnings).toHaveLength(1)
    expect(first.warnings[0]).toContain('src/actions.ts imports @acme/email, which imports react-dom/server')
    expect(first.warnings[0]).toContain('"use ssr"')
  })

  test('one that does not is left alone', async () => {
    const { warnings } = await run('@acme/plain', app, true)

    expect(warnings).toEqual([])
  })

  test('whether Vite answered it as external or as a file under node_modules', async () => {
    // Which of the two depends on how the environment was set up; both are a
    // dependency whose imports the build will not look inside.
    const { warnings } = await run('@acme/email', app, false)

    expect(warnings).toHaveLength(1)
  })

  test('an import from inside node_modules is not app code', async () => {
    const { warnings } = await run('@acme/email', join(root, 'node_modules/@acme/other/index.js'), true)

    expect(warnings).toEqual([])
  })
})
