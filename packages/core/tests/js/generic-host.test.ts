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
  const { rscKit } = await import('../../src/vite')
  const plugins = rscKit(options as never) as any[]
  const plugin = plugins.find((p) => p.name === 'rsc-kit')

  return plugin.config({}, { command: 'build', mode: 'production' })
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
  test("leaves the runtime's own modules to the runtime", async () => {
    // `import { SQL } from 'bun'` in a server module is the runtime's, like
    // `node:fs`. Bundled, the build under Node has nothing to resolve it to
    // and fails on a page it will never render there; left as an import, the
    // process that has it provides it. Both server environments, not the
    // browser's, where such an import is a mistake worth failing on.
    const root = mkdtempSync(join(tmpRoot(), 'host-'))
    mkdirSync(join(root, 'src/app'), { recursive: true })
    writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return null }')
    const config = await configFor({ projectRoot: root })
    const has = (env: string) =>
      (config.environments[env].build.rollupOptions.external as (string | RegExp)[]).some(
        (e) => e === 'bun' || (e instanceof RegExp && e.test('bun:sqlite')),
      )

    expect(has('rsc')).toBe(true)
    expect(has('ssr')).toBe(true)
    expect(config.environments.client.build.rollupOptions.external).toBeUndefined()
  })

  test('never names a client chunk after a "use server" module', async () => {
    // A "use server" file reaches the browser as a proxy that keeps the file's
    // identity, and the bundler can name a chunk after it - shared client
    // code merged in, and public/assets holds `auth-actions-….js` full of UI
    // components. Nothing leaked, but a name that says so is a bug. The hook
    // is the client build's chunk naming; without a plugin table in scope it
    // is Vite's default, and with one (Remorva's build was the check) a chunk
    // named for a server module is called `client-…`.
    const root = mkdtempSync(join(tmpRoot(), 'host-'))
    mkdirSync(join(root, 'src/app'), { recursive: true })
    writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return null }')
    const config = await configFor({ projectRoot: root })
    const name = config.environments.client.build.rollupOptions.output.chunkFileNames

    expect(typeof name).toBe('function')
    expect(name({ name: 'Icon', facadeModuleId: '/app/Icon.tsx', moduleIds: ['/app/Icon.tsx'] })).toBe(
      'assets/[name]-[hash].js',
    )
  })

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
      `import { rscKit } from ${JSON.stringify(join(packageRoot, 'src/vite.ts'))}\n` +
        'export default { plugins: [rscKit()] }\n',
    )

    const proc = Bun.spawnSync(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        RSC_PROJECT_ROOT: app,
        RSC_VITE_CONFIG: join(app, 'vite.config.mjs'),
        RSC_PACKAGE_DIR: join(packageRoot, 'src'),
        // Deliberately no RSC_SOURCE_DIR / RSC_OUT_DIR:
        // the plugin's own defaults are what is under test.
        RSC_SOURCE_DIR: '',
        RSC_OUT_DIR: '',
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
    expect(readFileSync(join(root, '.rsc-kit', 'rsc-env.d.ts'), 'utf-8')).toContain(
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

    const types = readFileSync(join(root, '.rsc-kit', 'rsc-routes.d.ts'), 'utf-8')

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

    const types = readFileSync(join(root, '.rsc-kit', 'rsc-routes.d.ts'), 'utf-8')

    expect(types).toContain('| "/promo"')
    expect(types).not.toContain('| "/(marketing)')
    // The group is in the file's path, and the search map imports the page by
    // its path - that is the one place it belongs.
    expect(types).toContain('"/promo": SearchExportOf<typeof import("../src/app/(marketing)/promo/page")>')

    rmSync(root, { recursive: true, force: true })
  })

  test('a deleted route stops being a valid href', async () => {
    // Rewritten every build like the other generated files: a stale union is a
    // link that compiles to a 404.
    const root = appWith({
      'src/app/page.tsx': 'export default function P() { return null }',
      '.rsc-kit/rsc-routes.d.ts':
        'declare module "@rsc-kit/core/routes" { interface Register { routes: "/gone" } }',
    })

    await configFor({ projectRoot: root })

    expect(readFileSync(join(root, '.rsc-kit', 'rsc-routes.d.ts'), 'utf-8')).not.toContain('/gone')

    rmSync(root, { recursive: true, force: true })
  })

  test('the only switch is internal, for a host that drives the build itself', async () => {
    // There is no public option: a page that must not be stored says
    // `await connection()`. A host driving the build from PHP prerenders
    // afterwards with paths only it knows, and watch mode has nothing to
    // store, so the environment carries the switch for those two.
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

describe('the ambient types this package ships', () => {
  test('declare what the engine owns, and not what a host owns', () => {
    // The split, now that the metadata types are imported rather than ambient:
    // this package owns them in metadata.ts, and a host owns the global it
    // installs — whose name only the host knows, since it configures it.
    //
    // Nothing ambient is shipped for them any more. The build writes only what
    // it must: the host global, the route union, and the engine module. A type
    // that can be imported is imported.
    const metadata = readFileSync(join(packageRoot, 'src/metadata.ts'), 'utf-8')

    expect(metadata).toContain('export interface Metadata')
    expect(metadata).toContain('export type GenerateMetadata')
    expect(metadata).not.toContain('declare function rpc')

    // The index signature is what made `titel` legal and left an editor with
    // nothing to suggest. Custom tags go under `other` instead.
    expect(metadata).not.toContain('[key: string]:')
    expect(metadata).toContain('other?: Record<')
  })
})

describe('what a JavaScript host is generated', () => {
  /**
   * Build a host with no backend and hand back its three generated entries.
   *
   * The plugin writes these into the app, so they are the exact surface a
   * pure-JS project ends up compiling — the place a backend idea would show up
   * if one leaked.
   */
  function entriesForAHostWithNoBackend(): Record<string, string> {
    const app = mkdtempSync(join(tmpRoot(), 'js-host-'))

    mkdirSync(join(app, 'src/app'), { recursive: true })
    writeFileSync(
      join(app, 'src/app/layout.tsx'),
      'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
    )
    writeFileSync(join(app, 'src/app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')
    // `type: module`, because every real app has it — the scaffolder writes it
    // and so does every framework template. Without it Vite emits index.mjs
    // while @vitejs/plugin-rsc still writes `import('../ssr/index.js')` into
    // the bundle, and the app cannot render HTML at all. That went unnoticed
    // here for as long as the build had nothing that imported what it produced.
    writeFileSync(join(app, 'package.json'), '{"name":"js-host-app","type":"module"}\n')
    // RSC_PRERENDER=0, because this app is here to be read and not to run —
    // there is no react() in its plugins and no React in its node_modules, so
    // rendering it throws on the first jsxDEV call. The test wants the three
    // generated entry files, which are written either way.
    //
    // It used to prerender without saying so and got away with it: the step
    // looked for the rsc bundle at a path this build does not use, found
    // nothing, and returned. Now that it renders when asked, an app that
    // cannot render has to say so.
    writeFileSync(
      join(app, 'vite.config.mjs'),
      `import { rscKit } from ${JSON.stringify(join(packageRoot, 'src/vite.ts'))}\n` +
        'export default { plugins: [rscKit()] }\n',
    )

    const proc = Bun.spawnSync(['bunx', 'vite', 'build', '--config', join(app, 'vite.config.mjs')], {
      cwd: app,
      // The internal switch: this app is here to be read, not to run.
      env: { ...process.env, RSC_PRERENDER: '0' },
    })

    expect(proc.exitCode).toBe(0)

    // outDir defaults to .rsc for a host that configures nothing, and the
    // entries land in its .gen — asserting the path is part of the point.
    const gen = join(app, '.rsc/.gen')
    const entries = Object.fromEntries(
      readdirSync(gen)
        .filter((f) => f.startsWith('entry.'))
        .map((f) => [f, readFileSync(join(gen, f), 'utf-8')]),
    )

    rmSync(app, { recursive: true, force: true })

    return entries
  }

  test('carries nothing shaped like a backend it does not have', () => {
    // A JavaScript host IS the backend. There is nothing to authenticate to,
    // nothing to hand an unmatched url to, and no adapter's vocabulary that
    // belongs in its entries — not in the code, and not in the comments, which
    // are copied verbatim into the app and teach whoever reads them.
    const entries = entriesForAHostWithNoBackend()

    expect(Object.keys(entries)).toHaveLength(3)

    for (const [name, source] of Object.entries(entries)) {
      for (const forbidden of [
        // The dev fall-through and its wire protocol.
        'FALLBACK_ORIGIN',
        'FALLBACK_MARKER',
        'PROXIED_MARKER',
        'x-forwarded-host',
        'x-rsc-renderer-fallback',
        'x-rsc-proxied-by-backend',
        // Any adapter's vocabulary.
        'Laravel',
        'artisan',
        'trustProxies',
        'php(',
        'PHP',
      ]) {
        expect(`${name}: ${source}`).not.toContain(forbidden)
      }
    }
  }, 180_000)

  test('still answers 404 itself, rather than reaching for a backend', () => {
    // The point of emitting nothing is that the handler is smaller, not that
    // it behaves differently — a url nothing owns is still this server's 404.
    const entries = entriesForAHostWithNoBackend()

    // Through notFound(), which renders the app's not-found.tsx when there is
    // one and answers the plain string when there is not. Either way it is
    // this server answering rather than a backend being asked.
    expect(entries['entry.rsc.tsx']).toContain(
      'return (await devHandler(request)) ?? (await notFound())',
    )
    expect(entries['entry.rsc.tsx']).toContain("new Response('Not found', { status: 404 })")
  }, 180_000)
})

/**
 * A setting that is read and then ignored is worse than one that is refused.
 *
 * Nitro publishes the browser assets and serves them from its own root. Set
 * assetsUrl alongside it and the markup asks for the app's prefix while Nitro
 * answers at its own: every asset 404s, every page still renders, and the
 * result is an unstyled document that never hydrates with nothing logged.
 * Measured on the docs app before this existed.
 */
describe('options that were removed', () => {
  const build = (options: Record<string, unknown>) => async () => {
    const { rscKit } = await import('../../src/vite')
    const root = mkdtempSync(join(tmpRoot(), 'assets-'))

    mkdirSync(join(root, 'src', 'app'), { recursive: true })
    writeFileSync(join(root, 'src', 'app', 'page.tsx'), 'export default () => null')

    return rscKit({ projectRoot: root, ...options } as never)
  }

  // All three described a build layout that no longer exists. Read and ignored
  // is the worst of the options: assetsUrl set against Nitro put a prefix in
  // the markup that nothing answered, so every asset 404'd while every page
  // still rendered — unstyled, never hydrating, nothing logged.
  test('refuses an assetsUrl', async () => {
    await expect(build({ assetsUrl: '/build/rsc-vite/' })()).rejects.toThrow(/no longer an option/)
  })

  test('refuses an assetsDir', async () => {
    await expect(build({ assetsDir: 'public/build/rsc-vite' })()).rejects.toThrow(/\.output\/public/)
  })

  test('names both when it finds both', async () => {
    await expect(build({ assetsDir: 'x', assetsUrl: '/x/' })()).rejects.toThrow(
      /assetsDir and assetsUrl are no longer an option/,
    )
  })

  // `nitro` is not among them. It is gone from the type, and Nitro is the only
  // build there is — so a config still passing `nitro: true` is asking for
  // exactly what it gets, and refusing it would break a working app to demand
  // a value that changes nothing.
  test('says nothing about a leftover nitro flag', async () => {
    await expect(build({ nitro: true })()).resolves.toBeDefined()
  })
})
