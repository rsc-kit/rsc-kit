/**
 * What the generated app must contain.
 *
 * Each of these fails by producing an app that builds and looks nearly right:
 * a development payload served to a production client, a stylesheet missing
 * every class a server component used, a prerender script that cannot be
 * typechecked. None of them throws, so none of them is caught by generating an
 * app and seeing it start.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Compiler, Host, Options } from '../src/options'
import * as t from '../src/templates'

const app = (over: Partial<Options> = {}): Options => ({
  lint: false,
  sourceDir: 'src',
  dir: '/tmp/app',
  name: 'app',
  host: 'bun',
  compiler: 'none',
  tailwind: false,
  install: false,
  git: false,
  core: '^0.1.0',
  ...over,
})

const HOSTS: Host[] = ['bun', 'hono', 'elysia', 'node']

describe('every host', () => {
  test.each(HOSTS)('%s builds a handler and falls through to a 404', (host) => {
    const source = t.server(app({ host }))

    expect(source).toContain('createRscHandler')
    // Null means "no route claimed this", and it has to become a 404 rather
    // than an empty 200 — a host that returns the null gets a blank page.
    expect(source).toMatch(/404/)
  })

  test.each(HOSTS)('%s imports the engine statically', (host) => {
    // `import(variable)` is invisible to a bundler, so `bun build --compile`
    // would leave the engine out of the binary entirely.
    expect(t.server(app({ host }))).toContain("import * as engine from './build/dist/rsc/index.js'")
  })

  test.each(HOSTS)('%s never sets NODE_ENV, anywhere', (host) => {
    // The build bakes the mode it ran in into the bundle, so a server is
    // production because it was built that way rather than because whoever
    // started it remembered to say so. Reintroducing it in a script means a
    // second source of truth that can disagree with the build.
    const scripts = JSON.parse(t.packageJson(app({ host }))).scripts as Record<string, string>

    for (const command of Object.values(scripts)) expect(command).not.toContain('NODE_ENV')

    // The prose may mention it; nothing may set it.
    expect(t.server(app({ host }))).not.toContain('process.env.NODE_ENV')
  })

  test.each(HOSTS)('%s runs dev through vite', (host) => {
    // Not a watcher on a production build: Vite re-evaluates modules on edit
    // and restarts when the route tree changes shape.
    expect(JSON.parse(t.packageJson(app({ host }))).scripts.dev).toBe('vite')
  })

  test.each(HOSTS)('%s prerenders through the CLI, not a copied script', (host) => {
    expect(JSON.parse(t.packageJson(app({ host }))).scripts.prerender).toStartWith('rsc-kit prerender')
  })

  test.each(HOSTS)('%s typechecks the entry it actually generated', (host) => {
    const included = JSON.parse(t.tsconfig(app({ host }))).include as string[]

    expect(included).toContain(t.serverFile(host))
  })
})

describe('what the app does not have to own', () => {
  test.each(HOSTS)('%s calls its server server.ts', (host) => {
    // One server per app, so it needs no qualifier. The example carries four
    // side by side and has to distinguish them; nothing generated does.
    expect(t.serverFile(host)).toBe('server.ts')
  })

  test('does list @vitejs/plugin-rsc, peer dependency or not', () => {
    // The generated entry imports '@vitejs/plugin-rsc/rsc' by specifier, so it
    // has to resolve from the app. bun hoists peers and makes that work by
    // accident; npm does not, and the build fails on a specifier nothing in
    // the app depends on. Testing this on bun alone says it is redundant.
    const dev = JSON.parse(t.packageJson(app())).devDependencies as Record<string, string>

    expect(dev).toHaveProperty('@vitejs/plugin-rsc')
  })

  test('ignores the engine declaration, which the build writes', () => {
    expect(t.gitignore).toContain('rsc-engine.d.ts')
  })
})

describe('oxlint', () => {
  const config = (over: Partial<Options> = {}) => JSON.parse(t.oxlintConfig(app(over)))

  test('turns on the rules the React Compiler needs to hold', () => {
    // These describe what the compiler must be able to assume in order to
    // memoise safely — worth running whether or not it is enabled.
    const rules = config().rules

    for (const rule of ['react/purity', 'react/set-state-in-render', 'react/immutability']) {
      expect(rules[rule]).toBe('error')
    }
  })

  test('drops exhaustive-deps when the compiler is on', () => {
    // The compiler infers dependencies; the rule then reports on code it has
    // already handled.
    expect(config({ compiler: 'none' }).rules['react/exhaustive-deps']).toBe('error')
    expect(config({ compiler: 'oxc' }).rules['react/exhaustive-deps']).toBe('off')
  })

  test('ignores what the build rewrites', () => {
    // A lint nobody can act on is a lint people learn to ignore.
    expect(config().ignorePatterns).toContain('src/rsc-*.d.ts')
  })

  test('brings oxlint and two scripts, only when asked for', () => {
    const withLint = JSON.parse(t.packageJson(app({ lint: true })))
    const without = JSON.parse(t.packageJson(app({ lint: false })))

    expect(withLint.devDependencies).toHaveProperty('oxlint')
    expect(withLint.scripts).toHaveProperty('lint:check')
    expect(without.devDependencies).not.toHaveProperty('oxlint')
    expect(without.scripts).not.toHaveProperty('lint')
  })
})

describe('the react compiler', () => {
  const config = (compiler: Compiler) => t.viteConfig(app({ compiler }))

  test('the plugin is there either way, because Fast Refresh needs it', () => {
    // @vitejs/plugin-react is what gives a client component Fast Refresh, so
    // leaving it out when the compiler is off means every edit to one is a
    // full reload and any state it held is gone. It is the compiler *option*
    // that is conditional, not the plugin.
    expect(config('none')).toContain("react()")
    expect(config('none')).not.toContain('compiler')
    expect(config('oxc')).toContain('react({ compiler: true })')
  })

  test('native goes through the plugin flag', () => {
    expect(config('oxc')).toContain('react({ compiler: true })')
  })

  test('babel goes through the preset, since the inline option was removed', () => {
    const source = config('babel')

    expect(source).toContain('reactCompilerPreset')
    expect(source).toContain('@rolldown/plugin-babel')
  })

  test.each(['oxc', 'babel'] as Compiler[])('%s brings its own dependencies', (compiler) => {
    const dev = JSON.parse(t.packageJson(app({ compiler }))).devDependencies as Record<string, string>

    expect(dev).toHaveProperty('@vitejs/plugin-react')
    expect(compiler === 'oxc' ? dev['oxc-transform-react'] : dev['babel-plugin-react-compiler']).toBeString()
  })
})

describe('tailwind', () => {
  test('declares the whole source tree as a source', () => {
    // A client component is found automatically because it enters the browser
    // bundle. A server component never does — without this the utilities layer
    // holds only what the generated entries mention, the build succeeds, and
    // the page arrives unstyled.
    expect(t.styles).toContain("@source '../'")
  })

  test('the layout imports the stylesheet, or none of it is emitted', () => {
    expect(t.layout(app({ tailwind: true }))).toContain("import './styles.css'")
    expect(t.layout(app({ tailwind: false }))).not.toContain('styles.css')
  })

  test('is absent from vite.config unless asked for', () => {
    expect(t.viteConfig(app({ tailwind: false }))).not.toContain('tailwindcss')
    expect(t.viteConfig(app({ tailwind: true }))).toContain('tailwindcss()')
  })
})

describe('the generated files', () => {
  test('ignore what the build rewrites into the source dir', () => {
    // Committed, these go stale against a build that renamed a route or the
    // host global, and the editor believes them.
    for (const generated of ['rsc-env.d.ts', 'rsc-types.d.ts', 'rsc-routes.d.ts']) {
      expect(t.gitignore).toContain(generated)
    }
  })

  test('the root layout owns <html>', () => {
    // React will not hydrate a document container through a wrapper — it does
    // not warn, it hangs the renderer.
    expect(t.layout(app())).toContain('<html lang="en">')
  })

  test('the page is a server component and the counter is not', () => {
    expect(t.page(app())).not.toContain('use client')
    expect(t.counter(app())).toStartWith("'use client'")
  })
})

test('the engine range follows this package version, not a constant', async () => {
  // `create-rsc-kit@0.2.0` shipped scaffolding apps that depended on
  // `@rsc-kit/core@^0.1.0`, because the range was written down in a second
  // place the release script does not touch. Every new project got the previous
  // engine, and nothing said so — the app installed, built, ran, and printed a
  // legend from the older release.
  //
  // Pointed at a manifest saying 9.9.9, it has to say ^9.9.9. A hardcoded range
  // fails this; reading its own version passes it at any version.
  const { publishedCore } = await import('../src/options')
  const dir = mkdtempSync(join(tmpdir(), 'rsc-core-range-'))

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'create-rsc-kit', version: '9.9.9' }),
  )

  expect(publishedCore(dir)).toBe('^9.9.9')

  rmSync(dir, { recursive: true, force: true })
})

/**
 * The Laravel host, which differs in kind rather than in wiring.
 *
 * The others ARE the application. This one renders for an application it talks
 * to, and every difference below follows from that: it holds no data, it
 * reaches PHP for all of it, and it has to fit into a project that already has
 * a vite config, a build directory and scripts named dev and build.
 */
describe('laravel', () => {
  const laravel = (over: Partial<Options> = {}) =>
    app({ host: 'laravel', sourceDir: 'resources/js/rsc', backend: 'http://my-app.test', ...over })

  test('renders for a backend rather than owning the data', () => {
    const source = t.server(laravel())

    expect(source).toContain('createBackedHandler')
    expect(source).not.toContain('createRscHandler')
    expect(source).toContain('/__rsc/host-call')
  })

  test('refuses to start without the shared secret', () => {
    // An empty secret is an endpoint that answers to anyone who can reach it,
    // and nothing would fail until someone did.
    const source = t.server(laravel())

    expect(source).toContain('RSC_HOST_CALL_SECRET')
    expect(source).toContain('process.exit(1)')
  })

  test('serves assets from the browser root, under the prefix the build wrote', () => {
    // The pair with no error case: an assetsDir the server does not serve 404s
    // every asset while every page still renders, so nothing hydrates and
    // nothing logs.
    const source = t.server(laravel())
    const paths = t.paths(laravel())

    expect(source).toContain("assetsDir: 'public'")
    expect(source).toContain(`assetsPrefix: '${paths.assetsUrl}'`)
    expect(t.viteConfig(laravel())).toContain(`assetsUrl: '${paths.assetsUrl}'`)
    expect(t.viteConfig(laravel())).toContain(`assetsDir: '${paths.assetsDir}'`)
  })

  test('the server imports the bundle the config writes', () => {
    const paths = t.paths(laravel())

    expect(t.server(laravel())).toContain(`from './${paths.outDir}/dist/rsc/index.js'`)
    expect(t.viteConfig(laravel())).toContain(`outDir: '${paths.outDir}'`)
  })

  test('writes a hot file, because Laravel has to find a dev server that picks its own port', () => {
    expect(t.viteConfig(laravel())).toContain("hotFile: 'public/rsc-hot'")
  })

  test('takes its own vite config, leaving the app pipeline alone', () => {
    // A Laravel app's vite.config carries laravel-vite-plugin, and the two
    // cannot share one: both set an input list, an outDir and a hot file.
    expect(t.configFile(laravel())).toBe('vite.rsc.config.ts')
    expect(t.configFile(app())).toBe('vite.config.ts')
  })

  test('takes the ordinary script names, and its own config file', () => {
    // What to do when those names are taken is init's decision, not the
    // template's — see the merge tests.
    const scripts = t.scripts(laravel())

    expect(scripts.dev).toContain('--config vite.rsc.config.ts')
    expect(scripts.build).toContain('vite build --config vite.rsc.config.ts')
  })

  test('writes the action manifest before every build and every dev server', () => {
    // Reflection through Composer's autoloader is the only thing that sees
    // what a class inherits, so PHP has to write the map first. A stale one
    // names a method that has since been renamed, and nothing fails until the
    // browser calls it.
    const scripts = t.scripts(laravel())

    expect(scripts.build).toContain('php artisan rsc:action-manifest &&')
    expect(scripts.dev).toContain('php artisan rsc:action-manifest &&')
  })

  test('the backend is where host calls go', () => {
    expect(t.server(laravel())).toContain("?? 'http://my-app.test'")
  })
})

describe('the tsconfig', () => {
  test('makes a type-only import say so, which the client/server split depends on', () => {
    // Erased silently, `import { Thing }` for a type looks identical to one
    // that drags a server module into the client bundle. In an RSC app that is
    // the whole distinction, so the source has to carry it rather than leaving
    // it to be inferred from the output.
    const config = JSON.parse(t.tsconfig(app({ host: 'bun' })))

    expect(config.compilerOptions.verbatimModuleSyntax).toBe(true)
  })

  test('only allows what a single-file transpiler can carry out', () => {
    // Vite hands each file to esbuild alone. Anything needing a view of
    // another file — a re-exported type without `export type`, a const enum —
    // compiles here and breaks there, which is the worst order to find out in.
    const config = JSON.parse(t.tsconfig(app({ host: 'bun' })))

    expect(config.compilerOptions.isolatedModules).toBe(true)
    expect(config.compilerOptions.moduleDetection).toBe('force')
  })
})
