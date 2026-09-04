/**
 * Tailwind is an app concern, not the engine's — the build compiles nothing
 * itself, it runs the project's Vite config. This proves that arrangement
 * actually works: a project that adds @tailwindcss/vite gets compiled CSS out
 * of the RSC build, with no cooperation from rscRoutes().
 *
 * Worth pinning because the plugin sets up five environments and its own
 * outDir; a CSS plugin that only ran in one of them, or wrote somewhere the
 * client bundle never references, would look fine until a page had styles.
 */

import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const packageRoot = join(import.meta.dir, '../..')
const built: string[] = []

afterAll(() => {
  for (const dir of built) rmSync(dir, { recursive: true, force: true })
})

describe('an app that adds Tailwind to its own config', () => {
  test('gets compiled utilities in the client CSS', () => {
    // Inside the project: `@import 'tailwindcss'` resolves through the
    // project's node_modules, exactly as it would in a real app.
    const app = mkdtempSync(join(packageRoot, '.tmp/tw-app-'))
    const buildDir = mkdtempSync(join(packageRoot, '.tmp/tw-'))
    built.push(app, buildDir)

    mkdirSync(join(app, 'app'), { recursive: true })
    // @source is required, not optional. Server components never enter the
    // client module graph, and Tailwind's automatic detection roots at the Vite
    // root rather than the RSC source dir — without this the utilities layer
    // comes out holding only classes scraped from the generated entries.
    writeFileSync(join(app, 'styles.css'), `@import 'tailwindcss';\n@source '${app}';\n`)
    writeFileSync(
      join(app, 'app/layout.tsx'),
      `import '../styles.css'
export default function L({ children }: any) { return <html><body>{children}</body></html> }
`,
    )
    // The utility only exists in the output if Tailwind scanned this file.
    writeFileSync(
      join(app, 'app/page.tsx'),
      'export default function P() { return <main className="text-3xl underline">hi</main> }\n',
    )

    writeFileSync(
      join(buildDir, 'vite.rsc.config.mjs'),
      `import { rscRoutes } from ${JSON.stringify(join(packageRoot, 'src/vite.ts'))}
import tailwindcss from ${JSON.stringify(join(packageRoot, 'node_modules/@tailwindcss/vite/dist/index.mjs'))}

export default { plugins: [tailwindcss(), rscRoutes()] }
`,
    )

    const proc = Bun.spawnSync(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        RSC_PROJECT_ROOT: packageRoot,
        RSC_SOURCE_DIR: app,
        RSC_OUT_DIR: buildDir,
        RSC_ASSETS_DIR: join(buildDir, 'public'),
        RSC_VITE_CONFIG: join(buildDir, 'vite.rsc.config.mjs'),
      },
    })

    expect(proc.exitCode).toBe(0)

    const assets = join(buildDir, 'public/assets')
    const css = readdirSync(assets)
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(assets, f), 'utf-8'))
      .join('\n')

    expect(css).not.toBe('')

    // Compiled from the class used in page.tsx, not shipped by the framework.
    expect(css).toContain('text-3xl')
    expect(css).toContain('underline')
    expect(css).toContain('text-decoration-line:underline')

    // A utility nobody used must not be there, or Tailwind did not scan at all.
    expect(css).not.toContain('bg-fuchsia-700')
  }, 180_000)
})

describe('without @source', () => {
  test('server-component classes never reach the CSS', () => {
    // Pins the trap rather than the fix: auto-detection alone silently drops
    // every class used in a server component, and the build still succeeds.
    const app = mkdtempSync(join(packageRoot, '.tmp/tw-app-'))
    const buildDir = mkdtempSync(join(packageRoot, '.tmp/tw-'))
    built.push(app, buildDir)

    mkdirSync(join(app, 'app'), { recursive: true })
    writeFileSync(join(app, 'styles.css'), "@import 'tailwindcss';\n")
    writeFileSync(
      join(app, 'app/layout.tsx'),
      `import '../styles.css'
export default function L({ children }: any) { return <html><body>{children}</body></html> }
`,
    )
    writeFileSync(
      join(app, 'app/page.tsx'),
      'export default function P() { return <main className="text-3xl underline">hi</main> }\n',
    )
    writeFileSync(
      join(buildDir, 'vite.rsc.config.mjs'),
      `import { rscRoutes } from ${JSON.stringify(join(packageRoot, 'src/vite.ts'))}
import tailwindcss from ${JSON.stringify(join(packageRoot, 'node_modules/@tailwindcss/vite/dist/index.mjs'))}

export default { plugins: [tailwindcss(), rscRoutes()] }
`,
    )

    const proc = Bun.spawnSync(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        RSC_PROJECT_ROOT: packageRoot,
        RSC_SOURCE_DIR: app,
        RSC_OUT_DIR: buildDir,
        RSC_ASSETS_DIR: join(buildDir, 'public'),
        RSC_VITE_CONFIG: join(buildDir, 'vite.rsc.config.mjs'),
      },
    })

    expect(proc.exitCode).toBe(0)

    const assets = join(buildDir, 'public/assets')
    const css = readdirSync(assets)
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(assets, f), 'utf-8'))
      .join('\n')

    // Tailwind ran — the preflight is there — but the page's classes are not.
    expect(css).toContain('@layer base')
    expect(css).not.toContain('.text-3xl')
  }, 180_000)
})
