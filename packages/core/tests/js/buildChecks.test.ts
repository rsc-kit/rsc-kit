/**
 * What the bundler is told not to report.
 *
 * Rolldown prints, after every build, which plugin hooks took the time. In
 * this build the answer never changes - the typecheck, run before the bundle
 * on purpose, and the two resolvers that look at every import - and a port
 * pasted the paragraph from its docker log asking what to do about it.
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

describe('the plugin-timings report', () => {
  test('is off for every environment the build runs', async () => {
    root = mkdtempSync(join(tmpdir(), 'rsc-build-checks-'))
    mkdirSync(join(root, 'src/app'), { recursive: true })
    writeFileSync(
      join(root, 'src/app/layout.tsx'),
      'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
    )
    writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')

    const plugins = rscKit({ projectRoot: root, sourceDir: join(root, 'src'), outDir: join(root, '.rsc-kit') }) as Array<{
      name?: string
      config?: (config: object, env: object) => Promise<{ build?: { rollupOptions?: { checks?: { pluginTimings?: boolean } } } }>
    }>
    const main = plugins.find((p) => p?.name === 'rsc-kit')!
    const config = await main.config!({}, { command: 'build', mode: 'production' })

    // Top-level, which every environment inherits unless it says otherwise.
    expect(config.build?.rollupOptions?.checks?.pluginTimings).toBe(false)
  })
})
