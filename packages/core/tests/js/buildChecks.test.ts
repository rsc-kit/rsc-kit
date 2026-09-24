/**
 * What the bundler is told not to report.
 *
 * Rolldown prints, after every build, which plugin hooks took the time. In
 * this build the answer never changes - the typecheck, run before the bundle
 * on purpose, and the two resolvers that look at every import - and a port
 * pasted the paragraph from its docker log asking what to do about it.
 *
 * It also says, once per "use server" file, that the file is dynamically
 * imported by the server-references map but statically by a page, so the
 * dynamic import will not move it into another chunk. A server bundle has no
 * chunk to lazy-load; the same port pasted eight of these.
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

describe('what a build does not report', () => {
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
      config?: (
        config: object,
        env: object,
      ) => Promise<{
        build?: { rollupOptions?: { checks?: { pluginTimings?: boolean } } }
        environments?: Record<string, { build?: { rollupOptions?: { checks?: { ineffectiveDynamicImport?: boolean } } } }>
      }>
    }>
    const main = plugins.find((p) => p?.name === 'rsc-kit')!
    const config = await main.config!({}, { command: 'build', mode: 'production' })

    // Top-level, which every environment inherits unless it says otherwise.
    expect(config.build?.rollupOptions?.checks?.pluginTimings).toBe(false)
  })

  test('the server bundles do not report a "use server" file as an ineffective dynamic import', async () => {
    // The server-references map dynamically imports every action file and
    // the page that uses one imports it statically - one warning per action
    // in every build, about a chunk a server bundle never lazy-loads. The
    // client build keeps the check: there a split that did not happen is a
    // finding.
    root = mkdtempSync(join(tmpdir(), 'rsc-build-checks-'))
    mkdirSync(join(root, 'src/app'), { recursive: true })
    writeFileSync(
      join(root, 'src/app/layout.tsx'),
      'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
    )
    writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')

    const plugins = rscKit({ projectRoot: root, sourceDir: join(root, 'src'), outDir: join(root, '.rsc-kit') }) as Array<{
      name?: string
      config?: (
        config: object,
        env: object,
      ) => Promise<{
        environments?: Record<string, { build?: { rollupOptions?: { checks?: { ineffectiveDynamicImport?: boolean } } } }>
      }>
    }>
    const main = plugins.find((p) => p?.name === 'rsc-kit')!
    const config = await main.config!({}, { command: 'build', mode: 'production' })

    expect(config.environments?.rsc?.build?.rollupOptions?.checks?.ineffectiveDynamicImport).toBe(false)
    expect(config.environments?.ssr?.build?.rollupOptions?.checks?.ineffectiveDynamicImport).toBe(false)
    expect(config.environments?.client?.build?.rollupOptions?.checks?.ineffectiveDynamicImport).toBeUndefined()
  })
})

describe('one copy of a dependency two client components share', () => {
  test('the ssr build groups node_modules into a single chunk', async () => {
    // Every client component is its own entry in the ssr build, and a
    // dependency two of them reach for was copied into each one's chunk.
    // Two copies of one component are two different functions - harmless
    // until a second bundler merges the scopes. bun build --compile does,
    // renames the second copy, and a partially prerendered page records
    // its tree BY COMPONENT NAME: the shell says <J>, the binary renders
    // <J2>, React refuses the replay and every hole falls to the browser.
    // Measured on a port: two copies of next-themes in the ssr output, a
    // compiled binary that could not finish a page, and the same build
    // finishing it perfectly when run uncompiled.
    root = mkdtempSync(join(tmpdir(), 'rsc-ssr-chunks-'))
    mkdirSync(join(root, 'src/app'), { recursive: true })
    writeFileSync(
      join(root, 'src/app/layout.tsx'),
      'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
    )
    writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')

    const plugins = rscKit({ projectRoot: root, sourceDir: join(root, 'src'), outDir: join(root, '.rsc-kit') }) as Array<{
      name?: string
      config?: (
        config: object,
        env: object,
      ) => Promise<{
        environments?: Record<
          string,
          { build?: { rollupOptions?: { output?: { advancedChunks?: { groups?: { name: string; test: RegExp }[] } } } } }
        >
      }>
    }>
    const main = plugins.find((p) => p?.name === 'rsc-kit')!
    const config = await main.config!({}, { command: 'build', mode: 'production' })
    const groups = config.environments?.ssr?.build?.rollupOptions?.output?.advancedChunks?.groups

    expect(groups?.map((g) => g.name)).toEqual(['vendor'])
    expect(groups![0].test.test('/app/node_modules/next-themes/dist/index.mjs')).toBe(true)
    expect(groups![0].test.test('/app/src/app/page.tsx')).toBe(false)
  })
})

describe('component names a second bundler cannot change', () => {
  test('are stamped on the ssr build, and nowhere else', () => {
    // A replay matches slots by component name, and bun build --compile
    // renames whatever collides - the engine's own PathnameProvider among
    // them. See stableNames.test.ts.
    root = mkdtempSync(join(tmpdir(), 'rsc-stable-names-'))
    mkdirSync(join(root, 'src/app'), { recursive: true })
    writeFileSync(
      join(root, 'src/app/layout.tsx'),
      'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
    )
    writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')

    const plugins = (rscKit({ projectRoot: root, sourceDir: join(root, 'src'), outDir: join(root, '.rsc-kit') }) as unknown[]).flat(
      Infinity,
    ) as Array<{ name?: string; apply?: string; applyToEnvironment?: (env: { name: string }) => boolean }>
    const stamp = plugins.find((p) => p?.name === 'rsc-kit:stable-component-names')!

    expect(stamp).toBeDefined()
    expect(stamp.apply).toBe('build')
    expect(stamp.applyToEnvironment!({ name: 'ssr' })).toBe(true)
    expect(stamp.applyToEnvironment!({ name: 'rsc' })).toBe(false)
    expect(stamp.applyToEnvironment!({ name: 'client' })).toBe(false)
  })
})
