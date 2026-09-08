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

const HOSTS: Host[] = ['bun', 'node', 'worker']
/**
 * A host is a Nitro preset now, not a server we write.
 *
 * These used to assert the shape of five generated server files. There are no
 * generated server files: Nitro builds the server around the rsc entry, so what
 * is worth pinning is the preset each host maps to and the commands that follow
 * from it.
 */
describe('every host', () => {
  test.each(HOSTS)('%s maps to a nitro preset', (host) => {
    expect(t.preset(host)).toBe(host === 'worker' ? 'cloudflare_module' : host)
  })

  test.each(HOSTS)('%s generates no server file', (host) => {
    const config = t.viteConfig(app({ host }))

    // The nitro() plugin is the whole server. There is no `nitro: true` on
    // rscKit() any more — the plugin builds for Nitro and nothing else, so a
    // flag saying so could only ever have one value.
    expect(config).toContain('nitro({')
    expect(config).not.toContain('nitro: true')
  })

  test.each(HOSTS)('%s inlines its static assets', (host) => {
    // Without this a compiled binary serves pages and 404s every asset: the
    // static path resolves into Bun's virtual filesystem, where the files on
    // disk are not.
    expect(t.viteConfig(app({ host }))).toContain("serveStatic: 'inline'")
  })

  test.each(HOSTS)('%s runs dev through vite', (host) => {
    expect(t.scripts(app({ host })).dev).toBe('vite')
  })

  test.each(HOSTS)('%s pins nitro rather than ranging over it', (host) => {
    // `^3.0.0` resolves to a plain 3.0.0 that sorts BELOW nitro's own dated
    // `latest` prerelease — it builds without complaint and 404s every route.
    const dev = JSON.parse(t.packageJson(app({ host }))).devDependencies

    expect(dev.nitro).toMatch(/^\d+\.\d+\.\d+-beta$/)
  })
})

describe('what the app does not have to own', () => {
  test.each(HOSTS)('%s writes no server file at all', (host) => {
    // There is nothing to name. Nitro builds the server from the rsc entry's
    // default export, so the app owns a route tree and a vite config and
    // nothing in between.
    expect(t.scripts(app({ host })).start ?? t.scripts(app({ host })).preview).toContain(
      '.output/server/index.mjs',
    )
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
