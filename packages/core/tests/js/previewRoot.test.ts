// Which root Vite is given, and when.
//
// The generated entries live in outDir, so a BUILD has to treat that as the
// root for Vite to resolve them as its own source. A preview must not: Nitro
// reads its build info from `<vite root>/node_modules/.nitro`, so pointing the
// root at a directory no build writes into made every `vite preview` fail with
// "Cannot load nitro build info. Make sure to build first." — after a build
// that had just succeeded, which is the version of that message nobody can act
// on.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { rscKit } from '../../src/vite'

// Absolute, because the working directory is not the same in both places this
// runs: locally from packages/core, in CI from the repository root. A relative
// sourceDir resolved to nothing there and both tests failed on a plugin that
// was working.
const packageRoot = join(import.meta.dir, '../..')

/** The config hook of the plugin that sets the root. */
async function configFor(env: { command: string; mode: string; isPreview?: boolean }) {
  const plugins = (await rscKit({
    sourceDir: join(packageRoot, 'tests/fixtures/rsc-app'),
    outDir: join(packageRoot, '.tmp/root-test'),
  })) as {
    name?: string
    config?: (config: unknown, env: unknown) => unknown
  }[]

  const owner = plugins.find((p) => p?.name === 'rsc-kit' && typeof p.config === 'function')

  return (await owner!.config!({}, env)) as { root?: string } | undefined
}

describe('the root vite is given', () => {
  test('is the generated directory when building', async () => {
    const config = await configFor({ command: 'build', mode: 'production' })

    expect(config?.root).toContain(join('.tmp', 'root-test'))
  })

  test('and is left alone when previewing', async () => {
    // Nitro's preview looks under Vite's root for what the build wrote. Ours is
    // not where any build writes, so overriding it here breaks preview outright.
    const config = await configFor({ command: 'serve', mode: 'production', isPreview: true })

    expect(config?.root).toBeUndefined()
  })
})
