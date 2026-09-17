// Whether an edit to a server component reaches the browser as an in-place
// refresh.
//
// It did not. Nitro's hotUpdate runs first, and for any environment that is
// not the browser's it treats a module the browser does not also have as "the
// server changed, reload the page": it sends full-reload and returns an EMPTY
// module list. A returned list replaces the modules every later hook sees, so
// plugin-rsc's handler - the one that knows a server component can be
// refetched in place - got nothing, returned early, and never sent
// rsc:update. With Tailwind in the chain, which rewrites the change as a css
// update before Nitro sees it, nothing reloaded at all.
//
// Tested against the real plugin list rather than a stub of it: the thing
// being asserted is what happens when the hooks run in order.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { rscKit } from '../../src/vite'

const packageRoot = join(import.meta.dir, '../..')

/**
 * The plugin list the way Vite hands it to configResolved: flattened, awaited,
 * and only entries that are plugins. rscKit() returns nested arrays and a
 * promise, which Vite resolves before any hook sees them.
 */
async function resolvedPlugins(extra: unknown[] = []) {
  const raw = (await rscKit({
    sourceDir: join(packageRoot, 'tests/fixtures/rsc-app'),
    outDir: join(packageRoot, '.tmp/hot-test'),
  })) as unknown[]

  const flat: { name?: string }[] = []

  const walk = async (items: unknown[]) => {
    for (const item of items) {
      const value = await item

      if (Array.isArray(value)) await walk(value)
      else if (value && typeof value === 'object') flat.push(value as { name?: string })
    }
  }

  await walk([...extra, ...raw])

  return flat.filter((p) => typeof p.name === 'string')
}

/** A stand-in for nitro:main with the hotUpdate that starved plugin-rsc. */
function fakeNitro() {
  const calls: string[] = []

  return {
    calls,
    plugin: {
      name: 'nitro:main',
      hotUpdate(this: { environment: { name: string } }) {
        calls.push(this.environment.name)

        return []
      },
    },
  }
}

describe('nitro and the rsc environment', () => {
  test('nitro\'s hotUpdate is kept out of the rsc environment', async () => {
    const nitro = fakeNitro()
    const plugins = (await resolvedPlugins([nitro.plugin])) as {
      name?: string
      configResolved?: (config: unknown) => unknown
    }[]

    const ours = plugins.find((p) => p.name === 'rsc-kit' && p.configResolved)

    await ours!.configResolved!({ plugins, build: {} })

    // The rsc environment: skipped, and the module list left alone for the
    // hook that knows what to do with it.
    const rsc = nitro.plugin.hotUpdate.call({ environment: { name: 'rsc' } })

    expect(rsc).toBeUndefined()
    expect(nitro.calls).toEqual([])

    // Every other environment: untouched. Nitro owns the server's reload story
    // and this is not a reason to take it away.
    const ssr = nitro.plugin.hotUpdate.call({ environment: { name: 'ssr' } })

    expect(ssr).toEqual([])
    expect(nitro.calls).toEqual(['ssr'])
  })

  test('and an app without nitro is left alone', async () => {
    const plugins = (await resolvedPlugins()) as {
      name?: string
      configResolved?: (config: unknown) => unknown
    }[]

    const ours = plugins.find((p) => p.name === 'rsc-kit' && p.configResolved)

    expect(() => ours!.configResolved!({ plugins, build: {} })).not.toThrow()
  })
})
