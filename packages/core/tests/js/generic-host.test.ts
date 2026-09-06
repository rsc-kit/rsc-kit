/**
 * The plugin is published on its own, so it must assume no particular backend.
 *
 * Laravel's conventions — the `route.php` marker, the `laravel-rsc` import
 * prefix, `resources/js/rsc`, `bootstrap/rsc` — are supplied by the Laravel
 * package at build time. None may be a default here, or the plugin quietly
 * only fits one host.
 */

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'

const packageRoot = join(import.meta.dir, '../..')

/**
 * The package's .tmp, created if it is not there.
 *
 * mkdtemp does not make parents, and a clean checkout has no .tmp — so
 * whichever test file ran first used to create it as a side effect, and
 * reordering them turned that into ENOENT on CI and nowhere else.
 */
function tmpRoot(): string {
  const dir = join(packageRoot, '.tmp')

  mkdirSync(dir, { recursive: true })

  return dir
}


/** Run the plugin's config hook and return what it contributed. */
async function configFor(options: Record<string, unknown>): Promise<any> {
  const { rscRoutes } = await import('../../src/vite')
  const plugins = rscRoutes(options as never) as any[]
  const routes = plugins.find((p) => p.name === 'rsc-routes')

  return routes.config({}, { command: 'build', mode: 'production' })
}

describe('the plugin source', () => {
  const source = readFileSync(join(packageRoot, 'src/vite.ts'), 'utf-8')

  test('names no backend-specific file convention', () => {
    // route.php is Laravel's marker for dynamic props; the plugin takes the
    // filename and pattern from its host instead of knowing either.
    expect(source).not.toContain("'route.php'")
    expect(source).not.toContain('route.rb')
  })

  test('defaults no import prefix to a particular package', () => {
    expect(source).not.toContain("packageAlias || 'laravel-rsc'")
    expect(source).not.toContain("options.packageAlias || 'laravel-rsc'")
  })

  test('defaults no path to a backend layout', () => {
    for (const laravelism of ['resources/js/rsc', 'bootstrap/rsc', 'public/build/rsc-vite']) {
      expect(source).not.toContain(`'${laravelism}'`)
    }
  })
})

describe('a host that passes nothing', () => {
  test('builds from src/app into dist/client and .rsc', () => {
    // Inside the package so the fixture resolves react/vite from node_modules,
    // the way a real project resolves its own.
    const app = mkdtempSync(join(tmpRoot(), 'generic-'))

    mkdirSync(join(app, 'src/app'), { recursive: true })
    writeFileSync(
      join(app, 'src/app/layout.tsx'),
      'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
    )
    writeFileSync(join(app, 'src/app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')
    writeFileSync(join(app, 'package.json'), '{"name":"generic-app"}\n')
    writeFileSync(
      join(app, 'vite.config.mjs'),
      `import { rscRoutes } from ${JSON.stringify(join(packageRoot, 'src/vite.ts'))}\n` +
        'export default { plugins: [rscRoutes()] }\n',
    )

    const proc = Bun.spawnSync(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        RSC_PROJECT_ROOT: app,
        RSC_VITE_CONFIG: join(app, 'vite.config.mjs'),
        RSC_PACKAGE_DIR: join(packageRoot, 'src'),
        // Deliberately no RSC_SOURCE_DIR / RSC_OUT_DIR / RSC_ASSETS_DIR:
        // the plugin's own defaults are what is under test.
        RSC_SOURCE_DIR: '',
        RSC_OUT_DIR: '',
        RSC_ASSETS_DIR: '',
        RSC_ASSETS_URL: '',
        RSC_PACKAGE_ALIAS: '',
        RSC_ROUTE_CONFIG_FILE: '',
        RSC_ROUTE_CONFIG_PATTERN: '',
      },
    })

    expect(proc.exitCode).toBe(0)
    expect(readdirSync(join(app, 'dist/client/assets')).some((f) => f.endsWith('.js'))).toBe(true)
    expect(readdirSync(join(app, '.rsc/dist'))).toContain('rsc')

    rmSync(app, { recursive: true, force: true })
  }, 180_000)
})

describe('the package alias', () => {
  test('is not applied when the package is installed', async () => {
    // An alias is a path rewrite and rewrites nothing through the package's
    // own exports, so with both in play `<pkg>/Form` meant one thing to the
    // bundler and another to the exports map. Installed, ordinary resolution
    // has to win.
    const root = mkdtempSync(join(tmpRoot(), 'alias-'))
    // A scoped name is two directories, not one — checking for the scope alone
    // would call any @rsc-kit package an install of this one.
    mkdirSync(join(root, 'node_modules', '@rsc-kit', 'core'), { recursive: true })
    mkdirSync(join(root, 'src', 'app'), { recursive: true })
    writeFileSync(join(root, 'src', 'app', 'page.tsx'), 'export default function P() { return null }')

    const config = await configFor({ projectRoot: root, packageAlias: '@rsc-kit/core' })

    expect(config.resolve?.alias ?? []).toEqual([])

    rmSync(root, { recursive: true, force: true })
  })

  test('is applied when it is not', async () => {
    const root = mkdtempSync(join(tmpRoot(), 'alias-'))
    mkdirSync(join(root, 'src', 'app'), { recursive: true })
    writeFileSync(join(root, 'src', 'app', 'page.tsx'), 'export default function P() { return null }')

    const config = await configFor({ projectRoot: root, packageAlias: '@rsc-kit/core' })

    expect(config.resolve?.alias ?? []).toHaveLength(1)

    rmSync(root, { recursive: true, force: true })
  })
})

describe('what the build produces', () => {
  test('a server build leaves the header doing the work', async () => {
    const root = mkdtempSync(join(tmpRoot(), 'output-'))
    mkdirSync(join(root, 'src', 'app'), { recursive: true })
    writeFileSync(join(root, 'src', 'app', 'page.tsx'), 'export default function P() { return null }')

    const config = await configFor({ projectRoot: root })

    expect(config.build?.rollupOptions).toBeUndefined()
    rmSync(root, { recursive: true, force: true })
  })

  test('an export build decides for itself that payloads need urls', async () => {
    // There is no server to read a header on a static host, so the client has
    // to be built asking for a file. The build knows that; nothing has to tell
    // it, and nothing else has to agree with it.
    const root = mkdtempSync(join(tmpRoot(), 'output-'))
    mkdirSync(join(root, 'src', 'app'), { recursive: true })
    writeFileSync(join(root, 'src', 'app', 'page.tsx'), 'export default function P() { return null }')

    await configFor({ projectRoot: root, output: 'export', exportPath: 'out' })

    const manifest = JSON.parse(readFileSync(join(root, '.rsc', 'routes.json'), 'utf-8'))

    expect(manifest.build).toEqual({
      output: 'export',
      exportPath: 'out',
      payloadName: 'index.rsc',
    })

    rmSync(root, { recursive: true, force: true })
  })

  test('a server build says so, and asks for no payload filename', async () => {
    const root = mkdtempSync(join(tmpRoot(), 'output-'))
    mkdirSync(join(root, 'src', 'app'), { recursive: true })
    writeFileSync(join(root, 'src', 'app', 'page.tsx'), 'export default function P() { return null }')

    await configFor({ projectRoot: root })

    const manifest = JSON.parse(readFileSync(join(root, '.rsc', 'routes.json'), 'utf-8'))

    expect(manifest.build.output).toBe('server')
    expect(manifest.build.payloadName).toBe('')

    rmSync(root, { recursive: true, force: true })
  })
})

describe('what the app imports but nobody writes', () => {
  function appWith(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpRoot(), 'host-'))

    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), contents)
    }

    return root
  }

  test('renders the host functions as ordinary imports', async () => {
    // The app writes `import { addTodo } from './server-actions.generated'`
    // and never names the transport. Discovery belongs to the host — these
    // are its functions — but the module has to land beside the app's source,
    // and that path is the build's.
    const root = appWith({ 'src/app/page.tsx': 'export default function P() { return null }' })

    await configFor({
      projectRoot: root,
      hostActions: { addTodo: 'TodoActions.add', removeTodo: 'TodoActions.remove' },
    })

    const module = readFileSync(join(root, 'src', 'server-actions.generated.ts'), 'utf-8')

    expect(module).toStartWith('"use server";')
    expect(module).toContain('export async function addTodo(...args: unknown[]) {')
    expect(module).toContain('"TodoActions.add"')
    expect(module).toContain('export async function removeTodo')

    rmSync(root, { recursive: true, force: true })
  })

  test('calls the global the host said it installs', async () => {
    // A renamed global is invisible at build time: the stub goes on calling
    // the old name and only the browser finds out. One name, one place.
    const root = appWith({ 'src/app/page.tsx': 'export default function P() { return null }' })

    await configFor({ projectRoot: root, hostGlobal: 'callHost', hostActions: { a: 'A' } })

    expect(readFileSync(join(root, 'src', 'server-actions.generated.ts'), 'utf-8')).toContain(
      '(globalThis as any).callHost("A", ...args)',
    )
    expect(readFileSync(join(root, 'src', 'rsc-env.d.ts'), 'utf-8')).toContain(
      'declare function callHost<T = unknown>',
    )

    rmSync(root, { recursive: true, force: true })
  })

  test('writes the routes it found as a type the app can be checked against', async () => {
    const root = appWith({
      'src/app/page.tsx': 'export default function P() { return null }',
      'src/app/orders/page.tsx': 'export default function P() { return null }',
      'src/app/posts/[slug]/page.tsx': 'export default function P() { return null }',
      'src/app/docs/[...path]/page.tsx': 'export default function P() { return null }',
    })

    await configFor({ projectRoot: root })

    const types = readFileSync(join(root, 'src', 'rsc-routes.d.ts'), 'utf-8')

    expect(types).toContain('"/"')
    expect(types).toContain('"/orders"')
    expect(types).toContain('"/posts/[slug]"')
    expect(types).toContain('"/docs/[...path]"')

    // Without a top-level export this is an ambient module declaration, which
    // *replaces* @rsc-kit/core/routes instead of augmenting it — Href and
    // route() vanish from it and nothing says why.
    expect(types).toContain('export {}')

    rmSync(root, { recursive: true, force: true })
  })

  test('a route group is not part of the url, so it is not part of the type', async () => {
    // app/(marketing)/promo answers /promo. Listing the group would make the
    // one href that works fail to compile.
    const root = appWith({
      'src/app/page.tsx': 'export default function P() { return null }',
      'src/app/(marketing)/promo/page.tsx': 'export default function P() { return null }',
    })

    await configFor({ projectRoot: root })

    const types = readFileSync(join(root, 'src', 'rsc-routes.d.ts'), 'utf-8')

    expect(types).toContain('"/promo"')
    expect(types).not.toContain('marketing')

    rmSync(root, { recursive: true, force: true })
  })

  test('a deleted route stops being a valid href', async () => {
    // Rewritten every build like the other generated files: a stale union is a
    // link that compiles to a 404.
    const root = appWith({
      'src/app/page.tsx': 'export default function P() { return null }',
      'src/rsc-routes.d.ts': 'declare module "@rsc-kit/core/routes" { interface Register { routes: "/gone" } }',
    })

    await configFor({ projectRoot: root })

    expect(readFileSync(join(root, 'src', 'rsc-routes.d.ts'), 'utf-8')).not.toContain('/gone')

    rmSync(root, { recursive: true, force: true })
  })

  test('does not prerender when told not to', async () => {
    // The build machine is not the production environment, and prerendering
    // runs the app: a page that needs a database needs it reachable from the
    // build. Off, the bundles are produced and every route renders per request.
    const root = appWith({ 'src/app/page.tsx': 'export default function P() { return null }' })

    await configFor({ projectRoot: root, prerender: false })

    expect(existsSync(join(root, '.rsc', 'static'))).toBe(false)

    rmSync(root, { recursive: true, force: true })
  })

  test('an out-of-process host can say so through the environment', async () => {
    // A host driving the build from PHP cannot pass an option, and may
    // prerender itself afterwards with paths only it knows.
    const root = appWith({ 'src/app/page.tsx': 'export default function P() { return null }' })

    process.env.RSC_PRERENDER = '0'

    try {
      await configFor({ projectRoot: root })

      expect(existsSync(join(root, '.rsc', 'static'))).toBe(false)
    } finally {
      delete process.env.RSC_PRERENDER
    }

    rmSync(root, { recursive: true, force: true })
  })

  test('leaves no stubs behind for a host that has no functions', async () => {
    // A JS host answers its own calls. Kept, these would name targets nothing
    // is listening for.
    const root = appWith({
      'src/app/page.tsx': 'export default function P() { return null }',
      'src/server-actions.generated.ts': 'export async function stale() {}',
    })

    await configFor({ projectRoot: root })

    expect(existsSync(join(root, 'src', 'server-actions.generated.ts'))).toBe(false)

    rmSync(root, { recursive: true, force: true })
  })
})

describe('the host route config', () => {
  test('is reported per route, so a host need not walk the tree again', async () => {
    const root = mkdtempSync(join(tmpRoot(), 'cfgman-'))

    mkdirSync(join(root, 'src/app/docs/[slug]'), { recursive: true })
    writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return null }')
    writeFileSync(join(root, 'src/app/docs/[slug]/page.tsx'), 'export default function P() { return null }')
    writeFileSync(join(root, 'src/app/route.php'), '<?php return 1;')
    writeFileSync(join(root, 'src/app/docs/route.php'), '<?php return 1;')
    writeFileSync(join(root, 'src/app/docs/[slug]/route.php'), '<?php return 1;')

    await configFor({
      projectRoot: root,
      routeConfig: { file: 'route.php', dynamicPattern: /props\(/ },
    })

    const manifest = JSON.parse(readFileSync(join(root, '.rsc', 'routes.json'), 'utf-8'))
    const page = manifest.routes.find((r: any) => r.component === 'app/docs/[slug]/page')

    // Relative to the project root: an absolute path is true only on the
    // machine that built it, and building in a container is ordinary.
    expect(page.config).toBe('src/app/docs/[slug]/route.php')
    // Outermost first — the host applies them in order and lets the inner one
    // win, so reversed they would silently resolve the opposite way — and
    // never the page's own, which it applies separately and last.
    expect(page.ancestorConfigs).toEqual(['src/app/route.php', 'src/app/docs/route.php'])

    const root_ = manifest.routes.find((r: any) => r.component === 'app/page')
    expect(root_.config).toBe('src/app/route.php')
    expect(root_.ancestorConfigs).toEqual([])

    rmSync(root, { recursive: true, force: true })
  })

  test('is absent for a host that names no such file', async () => {
    const root = mkdtempSync(join(tmpRoot(), 'cfgman-'))

    mkdirSync(join(root, 'src/app'), { recursive: true })
    writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return null }')
    writeFileSync(join(root, 'src/app/route.php'), '<?php return 1;')

    await configFor({ projectRoot: root })

    const manifest = JSON.parse(readFileSync(join(root, '.rsc', 'routes.json'), 'utf-8'))

    expect(manifest.routes[0].config).toBeNull()

    rmSync(root, { recursive: true, force: true })
  })
})

describe('routes that declare their own urls', () => {
  test('are recognised however the export is written', async () => {
    // An app may write it as a const arrow, or plain (not async) — both are
    // valid exports of the same thing. A scan that only matches `export async
    // function` records nothing, the manifest says the route declares no urls,
    // and it is quietly left out of the build with nothing to say why.
    const root = mkdtempSync(join(tmpRoot(), 'params-'))

    mkdirSync(join(root, 'src/app/a/[id]'), { recursive: true })
    mkdirSync(join(root, 'src/app/b/[id]'), { recursive: true })
    mkdirSync(join(root, 'src/app/c/[id]'), { recursive: true })

    writeFileSync(
      join(root, 'src/app/a/[id]/page.tsx'),
      'export async function generateStaticParams() { return [] }\nexport default function P() { return null }',
    )
    writeFileSync(
      join(root, 'src/app/b/[id]/page.tsx'),
      'export const generateStaticParams = () => []\nexport default function P() { return null }',
    )
    writeFileSync(
      join(root, 'src/app/c/[id]/page.tsx'),
      'export function generateStaticParams() { return [] }\nexport default function P() { return null }',
    )

    await configFor({ projectRoot: root })

    const manifest = JSON.parse(readFileSync(join(root, '.rsc', 'routes.json'), 'utf-8'))
    const declared = manifest.routes
      .filter((r: any) => r.staticParams)
      .map((r: any) => r.component)
      .sort()

    expect(declared).toEqual(['app/a/[id]/page', 'app/b/[id]/page', 'app/c/[id]/page'])

    rmSync(root, { recursive: true, force: true })
  })
})

describe('routes that ship no client runtime', () => {
  test('are recorded, and everything else defaults to shipping one', async () => {
    const root = mkdtempSync(join(tmpRoot(), 'plain-'))

    mkdirSync(join(root, 'src/app/plain'), { recursive: true })
    mkdirSync(join(root, 'src/app/typed'), { recursive: true })
    writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return null }')
    writeFileSync(
      join(root, 'src/app/plain/page.tsx'),
      'export const clientJs = false\nexport default function P() { return null }',
    )
    // A typed codebase may annotate it; the scan must not miss that spelling.
    writeFileSync(
      join(root, 'src/app/typed/page.tsx'),
      'export const clientJs: boolean = false\nexport default function P() { return null }',
    )

    await configFor({ projectRoot: root })

    const manifest = JSON.parse(readFileSync(join(root, '.rsc', 'routes.json'), 'utf-8'))
    const without = manifest.routes.filter((r: any) => !r.clientJs).map((r: any) => r.component).sort()

    expect(without).toEqual(['app/plain/page', 'app/typed/page'])

    rmSync(root, { recursive: true, force: true })
  })
})

describe('the ambient types this package ships', () => {
  test('declare what the engine owns, and not what a host owns', () => {
    // Two ambient declarations of the same name conflict, so the split is:
    // this package owns Metadata and GenerateMetadata, a host owns the global
    // it installs — whose name only the host knows, since it configures it.
    //
    // The other half of this is asserted in the Laravel adapter's suite. It
    // used to be asserted there alone, by reading this file across a package
    // boundary that no longer exists.
    const types = readFileSync(join(packageRoot, 'src/types.d.ts'), 'utf-8')

    expect(types).toContain('interface Metadata')
    expect(types).toContain('type GenerateMetadata')
    expect(types).not.toContain('declare function rpc')
  })
})
