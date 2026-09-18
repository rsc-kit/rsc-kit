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

  test('compile builds first, so it never packages a stale .output', () => {
    // Without it, a project that has never been built failed on a path it did
    // not write — and one built a while ago silently shipped the old code.
    expect(t.scripts(app({ host: 'bun' })).compile).toMatch(/^vite build && /)
  })

  test('and so does deploy, which ships what it finds', () => {
    expect(t.scripts(app({ host: 'worker' })).deploy).toMatch(/^vite build && /)
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

  test('ignores the directory the declarations are written into', () => {
    expect(t.gitignore).toContain('.rsc-kit/')
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
  test('ignore everything the build rewrites', () => {
    // Committed, these go stale against a build that renamed a route or the
    // host global, and the editor believes them. The declarations moved into
    // .rsc-kit; the stub stays in src, because the app imports it.
    expect(t.gitignore).toContain('.rsc-kit/')
    expect(t.gitignore).toContain('src/server-actions.generated.ts')
  })

  test('and the secrets, with the example left committable', () => {
    // A .env is the file whose commit is noticed late - after it is public.
    const lines = t.gitignore.split('\n')

    expect(lines).toContain('.env')
    expect(lines).toContain('.env.*')
    expect(lines).toContain('!.env.example')
  })

  test('the tsconfig can see the declarations, wherever they moved to', () => {
    // Ambient means inside the project, and `include` is what decides that.
    // Left out, typed routes fall back to string and nothing says so.
    expect(t.tsconfig(app({}))).toContain('.rsc-kit/**/*')
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

describe('room for api routes', () => {
  test('they need no configuration at all', () => {
    // An api route is `src/app/api/thing/route.ts` — inside the app directory
    // this package already scans, matched by the same router pages use. There
    // is no serverDir to set and no second directory to include: a scaffolded
    // config that needed either would be a config someone has to be told about.
    const config = t.viteConfig(app({ host: 'bun' }))

    expect(config).not.toContain('serverDir')

    const include = (JSON.parse(t.tsconfig(app({ sourceDir: 'src' }))) as { include: string[] })
      .include

    expect(include).toEqual(['src/**/*', 'tests/**/*', '.rsc-kit/**/*'])
  })
})

describe('metadata is typed', () => {
  test.each([
    ['page', (o: Options) => t.page(o)],
    ['layout', (o: Options) => t.layout(o)],
  ])('the scaffolded %s annotates its metadata', (_name, render) => {
    // Without the annotation there is no contextual type, so `title: 123` is
    // accepted and an editor offers no completions at all — which reads as the
    // editor being broken rather than the object being untyped.
    expect(render(app())).toContain('export const metadata: Metadata =')
  })
})

describe('the @ import alias', () => {
  test('tsconfig declares it, which is what tools look for', () => {
    // shadcn refuses to init without one: "Could not find valid path aliases
    // or package imports". It reads the tsconfig, not the vite config.
    const paths = (
      JSON.parse(t.tsconfig(app({ sourceDir: 'src' }))) as {
        compilerOptions: { paths?: Record<string, string[]> }
      }
    ).compilerOptions.paths

    expect(paths).toEqual({ '@/*': ['./src/*'] })
  })

  test('and no baseUrl, which TypeScript has removed', () => {
    // TS5102 on a freshly scaffolded app. Paths resolve relative to the
    // tsconfig without it.
    const options = (JSON.parse(t.tsconfig(app())) as { compilerOptions: Record<string, unknown> })
      .compilerOptions

    expect('baseUrl' in options).toBe(false)
  })

  test('vite resolves it too, because tsconfig paths alone do nothing', () => {
    // Vite does not read tsconfig paths. Without this half the import
    // type-checks and then fails to resolve at build time.
    expect(t.viteConfig(app())).toContain("'@': fileURLToPath(new URL('./src'")
  })

  test('it follows sourceDir rather than assuming src', () => {
    const paths = (
      JSON.parse(t.tsconfig(app({ sourceDir: 'app' }))) as {
        compilerOptions: { paths?: Record<string, string[]> }
      }
    ).compilerOptions.paths

    expect(paths).toEqual({ '@/*': ['./app/*'] })
    expect(t.viteConfig(app({ sourceDir: 'app' }))).toContain("new URL('./app'")
  })
})

describe('AGENTS.md', () => {
  test('renders with no escaping left in it', () => {
    // Written inside a template literal that itself contains fenced code
    // blocks, which is exactly where a backslash survives into the output and
    // the first thing an agent reads is \`bun run dev\`.
    const out = t.agents(app())

    expect(out).not.toContain('\\`')
    expect(out).toContain('```sh')
    expect(out).toContain('bun run dev')
  })

  test('names the project’s own source directory', () => {
    const out = t.agents(app({ sourceDir: 'app/js' }))

    expect(out).toContain('app/js/app')
    expect(out).toContain('app/js/app/**/route.ts')
  })

  test('uses npm for a node project', () => {
    expect(t.agents(app({ host: 'node' }))).toContain('npm run dev')
  })

  test('points the agent at the MCP server', () => {
    expect(t.agents(app())).toContain('.mcp.json')
  })
})

describe('the smoke test', () => {
  test('typechecks on a worker, whose tsconfig has to know bun:test', () => {
    const types = (JSON.parse(t.tsconfig(app({ host: 'worker' }))) as { compilerOptions: { types: string[] } })
      .compilerOptions.types

    expect(types).toContain('@types/bun')
    expect(types).toContain('@cloudflare/workers-types')
  })

  test('goes through createTestApp on bun', () => {
    const out = t.smokeTest(app())

    expect(out).toContain("from 'bun:test'")
    expect(out).toContain("createTestApp } from '@rsc-kit/core/testing'")
    expect(out).toContain("app.fetch('/')")
  })

  test('uses the node runner for a node project, and the scripts match', () => {
    expect(t.smokeTest(app({ host: 'node' }))).toContain("from 'node:test'")
    expect(t.scripts(app({ host: 'node' })).test).toBe('node --test "tests/**/*.test.ts"')
    expect(t.scripts(app()).test).toBe('bun test tests')
  })

  test('check is the whole list', () => {
    expect(t.scripts(app({ lint: true })).check).toBe('tsc --noEmit && oxlint src --deny-warnings && bun test tests')
    expect(t.scripts(app({ lint: false })).check).toBe('tsc --noEmit && bun test tests')
  })
})

describe('.mcp.json', () => {
  test('is the stdio server with nothing to install', () => {
    const config = JSON.parse(t.mcp())

    expect(config.mcpServers['rsc-kit']).toEqual({ command: 'npx', args: ['-y', '@rsc-kit/mcp'] })
  })

  test('covers the mistakes it exists to prevent', () => {
    // Each of these is a thing React or Next habits produce that looks right
    // and is not. If a line goes, the file has stopped earning its place.
    const out = t.agents(app())

    for (const must of [
      '"use client"',
      '"use server"',
      'createActionClient',
      'identity, not arguments',
      'await connection()',
      'getStaticProps',
    ]) {
      expect(out).toContain(must)
    }
  })
})
