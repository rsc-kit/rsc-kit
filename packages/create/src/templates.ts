// The files a new app gets.
//
// Kept as strings rather than a copied directory on purpose: the choices cross
// each other — the compiler changes vite.config, Tailwind changes it and the
// layout — and a template directory would need one copy per combination.

import type { Compiler, Host, Options } from './options.js'

const PORT = 3000

export interface Paths {
  /** Where the app/ route tree lives. */
  sourceDir: string
  /** Where the bundles land. The server imports the rsc one from here. */
  outDir: string
  /** Written while the dev server runs, for a backend that has to find it. */
  hotFile?: string
}

/**
 * Where this host's build writes.
 *
 * There is no assetsDir or assetsUrl any more. Nitro publishes the browser
 * assets to .output/public and serves them from its own root, so naming a
 * directory or a prefix here would be read and then ignored — the markup asks
 * for the app's path, Nitro answers at its own, and every asset 404s while
 * every page still renders. rscKit() refuses the pair outright rather than
 * letting that happen quietly.
 *
 * Laravel keeps its own outDir, because bootstrap/ is already where a Laravel
 * application puts generated code, and its own hotFile, because the framework
 * has to find a running dev server.
 */
export function paths(o: Options): Paths {
  if (o.host !== 'laravel') {
    return { sourceDir: o.sourceDir, outDir: 'build' }
  }

  return {
    sourceDir: o.sourceDir,
    outDir: 'bootstrap/rsc/vite',
    hotFile: 'public/rsc-hot',
  }
}

/**
 * The config the RSC build runs: the app's own, on every host.
 *
 * Laravel used to get a second file, vite.rsc.config.ts, on the reasoning
 * that laravel-vite-plugin and rscKit() cannot share one - which is true:
 * laravel-vite-plugin sets base, publicDir, outDir, the input list and the
 * server origin, and so does this build. But once the renderer owns the
 * frontend there is nothing left for laravel-vite-plugin to do: no @vite
 * directive, no public/hot, no Blade asset pipeline. The right answer is
 * one config with rscKit() in it, which is what the Laravel docs app runs.
 */
export const configFile = (_o: Options): string => 'vite.config.ts'

/**
 * The commands, under the names someone would guess.
 *
 * `dev` and `build`, even on Laravel where both are already taken. What to do
 * about that is init's decision and not this one — see mergeScripts, which
 * combines with the stock scripts and only steps aside for a script somebody
 * wrote themselves.
 */
export function scripts(o: Options): Record<string, string> {
  if (o.host === 'laravel') {
    const actions = 'php artisan rsc:action-manifest'

    return {
      // The ordinary names. A Laravel application already has `dev` and
      // `build`, and init combines rather than replaces — the stock ones run
      // the asset pipeline, and both pipelines belong to `npm run dev`.
      dev: `${actions} && vite`,
      build: `${actions} && vite build`,
      // What the build wrote. There is no server file to start any more.
      start: 'bun .output/server/index.mjs',
    }
  }

  // On Bun, Vite itself runs on Bun. `vite` is a bin with a node shebang, so
  // `bun run dev` alone still started it under Node - and a project that
  // imports `bun` or `bun:sqlite` failed at the first render with "Cannot
  // find package 'bun'", in a scaffold that had just said it was a Bun app.
  // `bun --bun` runs the bin on Bun's runtime; the dev server, the build and
  // the prerender then see the same runtime the server will.
  const vite = o.host === 'bun' ? 'bun --bun vite' : 'vite'

  return {
    dev: vite,
    build: `${vite} build`,
    // The two that produce something you ship build first, rather than reading
    // whatever .output happens to hold. Run on a project that has never been
    // built, they failed with `ENOENT opening root directory ".output/server"`
    // — a path the app did not write and has no reason to recognise. Run on one
    // built a while ago, which is worse, they silently packaged the old code.
    //
    // start and preview are left alone: they are the inner loop, they follow a
    // build in every set of instructions, and re-running one on each restart
    // costs more than it saves.
    ...(o.host === 'worker'
      ? {
          preview: 'wrangler dev .output/server/index.mjs',
          deploy: 'vite build && nitro deploy --prebuilt',
        }
      : {
          start: `${o.host === 'node' ? 'node' : 'bun'} .output/server/index.mjs`,
          // Bun only, and only because serveStatic: 'inline' is set in the vite
          // config. Without that the binary compiles, serves pages, and 404s
          // every asset — the static path resolves into Bun's virtual
          // filesystem, where the files on disk are not.
          //
          // Into dist/, which is already ignored. Named after the project it
          // landed a 63MB binary in the root of, next to the source, with
          // nothing in .gitignore covering it.
          ...(o.host === 'bun'
            ? {
                compile: `${vite} build && bun build --compile .output/server/index.mjs --outfile dist/app`,
              }
            : {}),
        }),
    typecheck: 'tsc --noEmit',
    ...(o.lint ? { lint: 'oxlint src --fix', 'lint:check': 'oxlint src --deny-warnings' } : {}),
    // Laravel returned above: its pages call into PHP that createTestApp does
    // not run, and its tests are Pest, on the other side.
    ...testScripts(o),
  }
}

function testScripts(o: Options): Record<string, string> {
  const test = o.host === 'node' ? 'node --test "tests/**/*.test.ts"' : 'bun test tests'

  return {
    test,
    // The one command an agent runs before saying it is done. Each part exists
    // on its own; this is so nothing has to remember the list.
    check: ['tsc --noEmit', ...(o.lint ? ['oxlint src --deny-warnings'] : []), test].join(' && '),
  }
}

export function packageJson(o: Options): string {
  const deps: Record<string, string> = {
    '@rsc-kit/core': o.core,
    react: '^19.2.5',
    'react-dom': '^19.2.5',
  }


  const dev: Record<string, string> = {
    '@types/react': '^19.2.18',
    '@types/react-dom': '^19.2.7',
    typescript: '^7.0.2',
    vite: '^8.1.5',
    // Pinned, and to a beta on purpose. Nitro's own `latest` tag is a dated
    // prerelease that sorts ABOVE the plain 3.0.0 on npm, so `^3.0.0` quietly
    // resolves to the older one — which builds without complaint and then 404s
    // every route. TanStack Start pins a dated beta for the same reason.
    nitro: '3.0.260903-beta',
    ...(o.host === 'worker'
      ? { wrangler: '^4.0.0', '@cloudflare/workers-types': '^5.0.0' }
      : {}),
    // Not redundant, though it is also the engine's peer: the generated entry
    // imports '@vitejs/plugin-rsc/rsc' by specifier, so it has to resolve from
    // the app. bun hoists peers and makes that work by accident; npm does not,
    // and the build fails on a specifier nothing in the app depends on.
    '@vitejs/plugin-rsc': '^0.5.34',
  }

  if (o.host !== 'node') dev['@types/bun'] = '^1.4.0'
  else dev['@types/node'] = '^24.0.0'

  // Always, not only for the compiler: this is also what gives a client
  // component Fast Refresh, so without it every edit to one is a full reload
  // and any state it held is gone.
  dev['@vitejs/plugin-react'] = '^6.0.0'

  if (o.compiler === 'oxc') dev['oxc-transform-react'] = 'latest'

  if (o.compiler === 'babel') {
    dev['@rolldown/plugin-babel'] = 'latest'
    dev['babel-plugin-react-compiler'] = 'latest'
  }

  if (o.tailwind) {
    dev['tailwindcss'] = '^4.0.0'
    dev['@tailwindcss/vite'] = '^4.0.0'
  }

  if (o.lint) dev['oxlint'] = '^1.81.0'

  if (o.validation === 'zod') deps['zod'] = '^4.0.0'
  if (o.validation === 'valibot') deps['valibot'] = '^1.0.0'
  if (o.validation === 'arktype') deps['arktype'] = '^2.1.0'
  if (o.env) deps['@t3-oss/env-core'] = '^0.13.0'

  return (
    JSON.stringify(
      {
        name: o.name,
        type: 'module',
        private: true,
        scripts: scripts(o),
        dependencies: sorted(deps),
        devDependencies: sorted(dev),
      },
      null,
      2,
    ) + '\n'
  )
}

const sorted = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

/** One server per app, so it needs no qualifier. */
/**
 * The Nitro preset for a host.
 *
 * This is the whole of what a host is now. Nitro carries presets for Vercel,
 * Netlify, Azure, Deno and the rest, and none of them need anything here — a
 * preset is a string in a config file, not a server we write and keep working.
 */
export const preset = (host: Host): string =>
  host === 'worker' ? 'cloudflare_module' : host === 'node' ? 'node' : 'bun'

/** @deprecated Nothing generates a server file. Kept until callers are gone. */
export const serverFile = (_host: Host): string => 'server.ts'

export function viteConfig(o: Options): string {
  const imports = ["import { defineConfig } from 'vite'"]
  const plugins: string[] = []

  imports.push(
    o.compiler === 'babel'
      ? "import react, { reactCompilerPreset } from '@vitejs/plugin-react'"
      : "import react from '@vitejs/plugin-react'",
  )

  if (o.compiler === 'babel') imports.push("import babel from '@rolldown/plugin-babel'")

  if (o.tailwind) imports.push("import tailwindcss from '@tailwindcss/vite'")

  imports.push("import { rscKit } from '@rsc-kit/core/vite'")
  imports.push("import { nitro } from 'nitro/vite'")

  const p = paths(o)

  // Where the build writes. Assets are not here: Nitro publishes those to
  // .output/public and serves them itself.
  const options = [
    `sourceDir: '${p.sourceDir}'`,
    `outDir: '${p.outDir}'`,
    ...(p.hotFile ? [`hotFile: '${p.hotFile}'`] : []),
  ]

  // Nitro leads: it builds the server around the rsc entry's default export,
  // and rscKit tells plugin-rsc not to install a handler competing for that
  // role. serveStatic: 'inline' embeds the built assets, without which a
  // compiled binary serves pages and 404s every asset.
  //
  // Not optional, and not a flag on rscKit() either — the plugin builds for
  // Nitro and nothing else, so a config without this line has no server.
  plugins.push(`nitro({ preset: ${JSON.stringify(preset(o.host))}, serveStatic: 'inline' })`)
  plugins.push(`rscKit({
      ${options.join(',\n      ')},
    })`)

  plugins.push(o.compiler === 'oxc' ? 'react({ compiler: true })' : 'react()')

  if (o.compiler === 'babel') plugins.push('babel({ presets: [reactCompilerPreset()] })')
  if (o.tailwind) plugins.push('tailwindcss()')

  // `@/` for the source directory. Vite does not read tsconfig `paths`, so the
  // alias has to exist here as well or the import type-checks and then fails to
  // resolve — and the tsconfig half is what tools like shadcn look for when
  // they ask whether this project has an import alias at all.
  return `${imports.join('\n')}
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    ${plugins.join(',\n    ')},
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./${o.sourceDir}', import.meta.url)),
    },
  },
})
`
}

export const WRANGLER_FILE = 'wrangler.toml'

export const tsconfig = (o: Options): string =>
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',

        // `@/thing` for `<sourceDir>/thing`. Matched by resolve.alias in the
        // vite config, which is what actually resolves it — this half is for
        // the type system, and for the tools that read a tsconfig to find out
        // whether the project has an import alias. shadcn refuses to init
        // without one.
        //
        // No `baseUrl`: TypeScript removed it, and emitting it now is an
        // outright TS5102 on a freshly scaffolded app. Paths resolve relative
        // to this file without it.
        paths: { '@/*': [`./${o.sourceDir}/*`] },
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,

        // Vite hands each file to esbuild alone, with no view of any other, so
        // the type system should only allow what a single-file transpiler can
        // actually carry out — re-exporting a type without `export type`, a
        // const enum, a file that is a script rather than a module.
        isolatedModules: true,
        moduleDetection: 'force',

        // An import means what it says. Without this, `import { Thing }` where
        // Thing is only a type is erased silently — and in an RSC app the
        // difference between an erased import and a real one is the difference
        // between a type reference and dragging a server module into the client
        // bundle. Requiring `import type` makes the graph split something you
        // can see in the source rather than infer from the output.
        verbatimModuleSyntax: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        types:
          o.host === 'worker'
            ? // A Worker has neither node globals nor Bun's: its own types, and
              // vite/client for import.meta.env. Bun's as well, because the
              // tests run under bun:test - the two sets coexist.
              ['@cloudflare/workers-types', 'vite/client', '@types/bun']
            : o.host === 'node'
              ? ['node', 'vite/client']
              : ['@types/bun', 'vite/client'],
      },
      // .rsc-kit holds the generated ambient declarations. Ambient means
      // inside the project, and `include` is what decides that — leave it out
      // and typed routes silently fall back to string.
      include: [`${o.sourceDir}/**/*`, 'tests/**/*', '.rsc-kit/**/*'],
    },
    null,
    2,
  ) + '\n'


export function layout(o: Options): string {
  return `${o.tailwind ? "import './styles.css'\n" : ''}import type { ReactNode } from 'react'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = {
  title: { template: '%s · ${o.name}', default: '${o.name}' },
}

// The root layout owns <html>. Everything below it is a segment the router can
// replace on its own without re-rendering this.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body${o.tailwind ? ' className="min-h-screen bg-white text-slate-900"' : ''}>
        <main${o.tailwind ? ' className="mx-auto max-w-2xl p-8"' : ''}>{children}</main>
      </body>
    </html>
  )
}
`
}

/**
 * A test that goes through the real build, so there is one to extend.
 *
 * Without it, "add a test" starts with choosing a runner and a way to reach
 * the app, and what gets chosen is a port, a spawned server, and a sleep. This
 * is the shape instead: the deployed handler, a Request in, a Response out.
 */
/** Bun's test settings: the preload below, before every test file. */
export const bunfig = `[test]
preload = ["./tests/preload.ts"]
`

/**
 * What every test file sees first.
 *
 * `import 'server-only'` is honoured by the build - a client file importing
 * the module fails to build rather than shipping a secret - and resolves to
 * nothing on the server. Under bun test it is the real package, which throws
 * on import, so an action or a route that carries the line would not be a
 * function a test can call. Stubbed here, once.
 */
export const testPreload = `import { mock } from 'bun:test'

// The build honours this import and resolves it to nothing on the server;
// the real package throws when imported, which is what a test would hit.
mock.module('server-only', () => ({}))
mock.module('client-only', () => ({}))
`

export function smokeTest(o: Options): string {
  const runner =
    o.host === 'node'
      ? `import { before, describe, test } from 'node:test'
import assert from 'node:assert/strict'`
      : `import { beforeAll, describe, expect, test } from 'bun:test'`
  const setup = o.host === 'node' ? 'before' : 'beforeAll'
  const ok =
    o.host === 'node'
      ? `    assert.equal(res.status, 200)
    assert.match(await res.text(), /${o.name}/)`
      : `    expect(res.status).toBe(200)
    expect(await res.text()).toContain('${o.name}')`
  const missing =
    o.host === 'node'
      ? `    assert.equal((await app.fetch('/no-such-page')).status, 404)`
      : `    expect((await app.fetch('/no-such-page')).status).toBe(404)`

  return `// The whole app as it is deployed, without a port or a browser.
//
// createTestApp builds when the source is newer than the last build and hands
// back the same Request → Response handler the server runs: the real router,
// the real middleware, the real api routes, the pages the build stored.
${runner}
import { createTestApp } from '@rsc-kit/core/testing'

let app: Awaited<ReturnType<typeof createTestApp>>

${setup}(async () => {
  app = await createTestApp()
}${o.host === 'node' ? '' : ', 120_000'})

describe('the app', () => {
  test('serves the home page', async () => {
    const res = await app.fetch('/')

${ok}
  })

  test('answers a url that matches nothing with a 404', async () => {
${missing}
  })
})
`
}

export function page(o: Options): string {
  const h1 = o.tailwind ? ' className="text-3xl font-bold"' : ''
  const p = o.tailwind ? ' className="mt-4 text-slate-600"' : ''
  const code = o.tailwind ? ' className="rounded bg-slate-100 px-1"' : ''

  // Deliberately nothing that changes between renders.
  //
  // This page said "Rendered on the server at {new Date()}" — and every route
  // it can is frozen at build time, so that timestamp was the build's and
  // never moved again. Reload and the same instant is still there, under a
  // sentence claiming it was rendered just now. The first thing the starter
  // did was look broken, and the fix someone reaches for is to stop
  // prerendering the page that is teaching them about prerendering.
  return `import { Counter } from '../components/Counter'
import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Home' }

// A server component. It runs on the server and ships no JavaScript of its
// own — this file is not in the browser bundle. It can be \`async\` and await
// whatever it needs; nothing here does yet.
export default function HomePage() {
  return (
    <>
      <h1${h1}>${o.name}</h1>
      <p${p}>
        The only JavaScript on this page is the counter below, because
        <code${code}>Counter.tsx</code> is the only file that opts into the
        client. Everything else rendered on the server and stayed there.
      </p>

      <Counter />

      <p${p}>
        Edit <code${code}>src/app/page.tsx</code> and the change arrives without
        a reload. Add <code${code}>src/app/about/page.tsx</code> and{' '}
        <code${code}>/about</code> exists — there is no route table to update.
      </p>
    </>
  )
}
`
}

export function counter(o: Options): string {
  const button = o.tailwind
    ? ' className="mt-6 rounded border px-3 py-1 hover:bg-slate-50"'
    : ''

  return `'use client'

import { useState } from 'react'

// "use client" is the boundary: this component and what it imports are the
// only things that reach the browser.
export function Counter() {
  const [count, setCount] = useState(0)

  return (
    <button${button} onClick={() => setCount(count + 1)}>
      Clicked {count} times
    </button>
  )
}
`
}

/**
 * Tailwind needs @source pointing at the RSC tree.
 *
 * Server components never enter the client module graph and Tailwind's
 * detection roots at the Vite root, so without this the utilities layer holds
 * only classes scraped from the generated entries. The build still succeeds
 * and nothing warns — the page just arrives unstyled.
 */
export const styles = `@import 'tailwindcss';

/* The whole source tree, not just this directory. A client component is found
   automatically because it enters the browser bundle; a server component never
   does, so anything it uses has to be declared here or it is silently absent
   from the stylesheet. */
@source '../';
`

export const gitignore = `node_modules
build
.output
.rsc
dist
*.log
.DS_Store

# Rewritten by the build every run: the ambient declarations, and the stub
# module the app imports its server actions from.
.rsc-kit/
src/server-actions.generated.ts

# Secrets. The example is the one to commit.
.env
.env.*
!.env.example
`

/**
 * oxlint, with the React Compiler's own rules turned on.
 *
 * Those `react/*` rules are the interesting half here: purity, immutability,
 * set-state-in-render. They describe what the compiler needs in order to
 * memoise safely, and they are worth running whether or not the compiler is
 * enabled — a component that breaks them is a component with a bug the
 * compiler would have made louder.
 *
 * `correctness: error` rather than the enumerated list an eslint migration
 * leaves behind: a new project has nothing to grandfather in.
 */
export function oxlintConfig(o: Options): string {
  return (
    JSON.stringify(
      {
        $schema: './node_modules/oxlint/configuration_schema.json',
        plugins: ['typescript', 'react', 'unicorn'],
        categories: { correctness: 'error' },
        env: { builtin: true, browser: true, node: true },
        rules: {
          'react/rules-of-hooks': 'error',
          'react/purity': 'error',
          'react/set-state-in-render': 'error',
          'react/set-state-in-effect': 'error',
          'react/immutability': 'error',
          'react/preserve-manual-memoization': 'error',
          'react/error-boundaries': 'error',
          'react/refs': 'error',
          'react/globals': 'error',
          'react/static-components': 'error',
          // Off, not error: the compiler infers dependencies, and the rule
          // reports on code it has already handled.
          'react/exhaustive-deps': o.compiler === 'none' ? 'error' : 'off',
          'typescript/no-explicit-any': 'error',
          'typescript/ban-ts-comment': 'error',
          'typescript/no-unsafe-function-type': 'error',
          'no-unused-vars': 'error',
          'prefer-const': 'error',
          'no-var': 'error',
        },
        // The build rewrites these on every run, and lints nobody can act on
        // are lints people learn to ignore.
        ignorePatterns: ['build', 'dist', `${o.sourceDir}/rsc-*.d.ts`],
      },
      null,
      2,
    ) + '\n'
  )
}

/**
 * What an agent working in this project needs to know and would otherwise guess.
 *
 * Not a summary of the documentation. Every line here is a thing that is easy
 * to get wrong from React or Next habits and produces code that looks right:
 * the wrong directive, a client component reaching for the request, a check
 * written in the component instead of the action. An agent that knows the
 * documentation exists will still write those, because they are what the
 * neighbouring frameworks taught it.
 *
 * AGENTS.md rather than CLAUDE.md: it is the cross-tool name, and Claude Code
 * reads it too.
 */
export function agents(o: Options): string {
  const pm = o.host === 'node' ? 'npm run' : 'bun run'

  return `# Working in this project

React Server Components through \`@rsc-kit/core\`, a Vite plugin. Routes are
files under \`${o.sourceDir}/app\`. There is no server file to edit — the build
generates it.

Read the guides at https://docs.rsc-kit.dev before reaching for a pattern from
another framework. The notes below are only the things most often got wrong.

The \`rsc-kit\` MCP server in \`.mcp.json\` answers from this project's last
build — which routes froze and why, what is heaviest — and has the long-form
recipe for anything here (\`how_to\`). Ask it before guessing.

## Commands

\`\`\`sh
${pm} dev        # vite, with the engine in it
${pm} build      # builds and prerenders; prints what it froze
${o.host === 'laravel' ? `${pm} typecheck` : `${pm} check      # typecheck, lint and tests — run before saying it is done`}
\`\`\`
${
  o.host === 'laravel'
    ? ''
    : `
Tests live in \`tests/\` and go through the real build: \`createTestApp()\` from
\`@rsc-kit/core/testing\` hands back the deployed Request → Response handler,
so a test fetches a url and reads the response. Extend \`tests/app.test.ts\`;
do not add a runner, a port or a spawned server. Actions, queries and api
routes are plain functions and can also be called directly.

**A change is not done without its test.** A guarded route gets a test that a
stranger is turned away; an action gets a test of its refusal, and one that
someone else's id is refused; an api route gets its 4xx. The exact shapes are
in \`how_to({ topic: 'testing' })\`. Then \`${pm} check\`. Nothing here needs
the app running - the build and the tests are the verification.
`
}
**Read the build output.** It is not decoration — it says which routes were
stored, which render per request, and why:

\`\`\`
  ○  /account               85 kB
  ◐  /locale                85 kB
     cookies(), headers() stream per request; the rest is stored
\`\`\`

If a page you expected to be static is not, the reason is on that line. Do not
guess at it.

## Server and client

Every component is a **server** component unless its file starts with
\`"use client"\`. Server components can be \`async\` and read the database
directly. They do not ship to the browser.

Add \`"use client"\` only when the file needs state, an effect, an event
handler or a browser API. It is a boundary, not a label: everything that file
imports goes to the browser too.

\`"use server"\` is a different thing and not the opposite. It marks a module
whose exports may be **called from** the browser — a server action.

\`\`\`ts
'use server'
export async function createPost(input) { … }   // callable from a client component
\`\`\`

Do not put \`"use server"\` at the top of a page to make it a server component.
It already is one.

A callback that a timer, a subscription or a listener calls and that must see
the latest props is \`useEffectEvent\` from React, not a ref you assign every
render. An Effect Event is never a dependency: leave it out of the array. The
engine's own hooks are written this way.

## Reading the request

\`cookies()\`, \`headers()\` and \`searchParams()\` come from
\`@rsc-kit/core/request\` and are **async**. So are a page's \`params\` and
\`searchParams\` props, and an api route's.

Reading any of them makes the page render per request instead of being frozen
at build time. That is usually correct — just know that it is the trade.

\`await connection()\` says "render this per visitor" deliberately, when
nothing else in the page happens to say it.

## Startup

\`${o.sourceDir}/instrumentation.ts\` runs once before anything else — at
startup on a server, at the first request on a Worker — and the entry imports
it before any page. ${
  o.env
    ? "It imports \`./env\`, so a missing or malformed variable stops the server from starting rather than reaching a visitor. "
    : ''
}Put once-per-process setup there (\`register()\` may be async, and the first
render waits for it). Do not import a bootstrap module from pages to get the
same effect; it depends on nobody forgetting.

## Forms

Uncontrolled. Inputs keep their value in the DOM, an initial value is
\`defaultValue\`, and the action reads \`FormData\`. Do not write \`useState\` +
\`value\`/\`onChange\` per input. Control one field only when the UI must react
as the user types, and bind that one with \`useField\`.

## Data

Fetch in a server component and await it. There is no loader and no
\`getServerSideProps\`.

Better still, do not await it — pass the promise to a client component and let
it \`use()\` the value. The shell paints immediately and the data streams into
the same response, with no request from the browser:

\`\`\`tsx
export default function Page() {
  const posts = getPosts()            // not awaited

  return (
    <Suspense fallback={<Skeleton />}>
      <List posts={posts} />          {/* "use client": use(posts) */}
    </Suspense>
  )
}
\`\`\`

For data the **browser** decides to fetch — a filter, a refresh — use TanStack
Query or SWR. This project does not ship a cache and should not grow one.

## Actions, and where the check goes

An action is a public endpoint. Anyone can call it directly, so the
authorisation check belongs **inside the action**, never in the component that
renders the button.

Build actions from a client so the check cannot be forgotten:

\`\`\`ts
'use server'
import { createActionClient } from '@rsc-kit/core/action'

export const client = createActionClient().use(async ({ next }) => {
  const user = await currentUser()

  if (!user) throw new ServerAuthenticationError()

  return next({ ctx: { user } })
})

export const createPost = client.input(schema).handler(async ({ input, ctx }) => …)
export const listPosts  = client.query(async ({ ctx }) => …)
\`\`\`

\`.handler()\` is a mutation, \`.query()\` is a read sent as a GET. Both run
the middleware, so \`ctx.user\` is typed and non-null inside them.

Authorise on **identity, not arguments**. \`deletePost(id)\` that trusts the id
is an IDOR — the caller chooses the id.

Middleware in \`middleware.ts\` guards a route tree. It does **not** run for
actions, because an action renders no route.

## Urls are input

Export a schema beside the page or route and the values arrive parsed and typed:

\`\`\`ts
export const params = z.object({ slug: z.string().min(1) })
export const searchParams = z.object({ page: z.coerce.number().int().min(1).default(1) })
\`\`\`

Bad \`params\` answer 404, bad \`searchParams\` reach the error boundary. Do
not hand-parse \`Number(searchParams.get('page'))\`.

## Api routes

\`${o.sourceDir}/app/**/route.ts\`, exporting \`GET\`, \`POST\` and so on.
A real \`Request\` in, a real \`Response\` out. Await \`params\`,
\`searchParams\` and \`body\` from the second argument - never
\`new URL(request.url).searchParams\`, which the build cannot see.

They run their directory's \`middleware.ts\`, and a \`GET\` that reads nothing
from the request is answered from disk.

## Things that are not this project

- No \`pages/\` directory, no \`_app\`, no \`getStaticProps\`.
- No \`next/link\`, \`next/image\` or \`next/navigation\` — use
  \`@rsc-kit/core/Link\` and \`@rsc-kit/core/navigate\`.
- No \`express\`/\`fastify\` server to write. Do not add one.
- Do not install a state manager to move data from server to client. Props and
  promises already cross that boundary.
`
}

/**
 * Project-scoped MCP config, which Claude Code reads from the project root
 * and asks the user to approve on first use. Nothing is installed: npx fetches
 * the server the first time an agent starts it. Other clients want the same
 * four lines in their own file.
 */
export function mcp(o?: Options): string {
  // bunx on a Bun project, npx elsewhere: the same server either way, but an
  // editor launching it should not need npm on a machine that has Bun.
  const launcher =
    o && o.host !== 'node'
      ? { command: 'bunx', args: ['@rsc-kit/mcp'] }
      : { command: 'npx', args: ['-y', '@rsc-kit/mcp'] }

  return (
    JSON.stringify(
      {
        mcpServers: {
          'rsc-kit': launcher,
        },
      },
      null,
      2,
    ) + '\n'
  )
}

export function readme(o: Options): string {
  const pm = o.host === 'node' ? 'npm run' : 'bun run'
  const runtime = o.host === 'worker' ? 'Cloudflare Workers' : o.host === 'node' ? 'Node' : 'Bun'

  // A Worker is deployed rather than started, and only Bun compiles.
  const serve =
    o.host === 'worker'
      ? `${pm} preview     # wrangler dev, on workerd\n${pm} deploy      # nitro deploy --prebuilt`
      : `${pm} start       # serve on http://localhost:${PORT}`

  const compile =
    o.host === 'bun'
      ? `\n\n\`${pm} compile\` builds and then puts the whole application into
\`dist/app\` — engine, pages and assets, with Bun's runtime inside it. Run it
directly:

\`\`\`sh
./dist/app
\`\`\`

It builds first, so the binary is never a version behind your source. Frozen
pages stay outside it: a binary has no filesystem to read them from, so it
renders those live.`
      : ''

  return `# ${o.name}

React Server Components, served by ${runtime}.

\`\`\`sh
${pm} dev         # vite — serves from source, no build step
${pm} build       # bundles, then freezes every page it can
${serve}
\`\`\`

There is no server file here. \`vite.config.ts\` names a Nitro preset and the
server is built around your route tree, into \`.output/\` — changing where this
deploys is changing that one string.${compile}

Freezing is part of \`build\`: it renders every page it can and stores the
result, so those pages are read off disk instead of rendered per visitor.
There is no switch to turn it off for the app; a page that must render per
request says \`await connection()\`, and the build names any page it could
not render.

## Where things go

    src/app/layout.tsx     the root layout; owns <html>
    src/app/page.tsx       /
    src/app/styles.css     imported by the layout
    src/components/        client components ("use client")

A directory with a \`page.tsx\` is a route, so \`src/app/about/page.tsx\` is
\`/about\` with nothing to register. \`[slug]\` is a parameter, and
\`middleware.ts\` runs before anything at or below it renders.

\`.rsc-kit/\` is the build's: the route types that make \`href\` checkable, and
the ambient declarations. Rewritten every build, and gitignored.

Docs: https://docs.rsc-kit.dev
`
}

/**
 * Typed environment variables, read once at startup.
 *
 * A missing or malformed variable is refused here, with its name, before
 * anything runs - not as an `undefined` three calls later. Server variables
 * never reach the browser; a client one has to carry the prefix, and is read
 * from import.meta.env, which is what Vite exposes there.
 */
export function env(o: Options): string {
  const lib = {
    zod: {
      imp: "import * as z from 'zod'",
      url: 'z.url()',
      str: 'z.string().min(1)',
      opt: "z.enum(['development', 'production', 'test']).default('development')",
    },
    valibot: {
      imp: "import * as v from 'valibot'",
      url: 'v.pipe(v.string(), v.url())',
      str: 'v.pipe(v.string(), v.minLength(1))',
      opt: "v.optional(v.picklist(['development', 'production', 'test']), 'development')",
    },
    arktype: {
      imp: "import { type } from 'arktype'",
      url: "type('string.url')",
      str: "type('string > 0')",
      opt: "type(\"'development' | 'production' | 'test' | undefined\")",
    },
  }[o.validation === 'none' ? 'zod' : o.validation]

  return `${lib.imp}
import { createEnv } from '@t3-oss/env-core'

// Read once, here, and refused with the variable named when one is missing
// or wrong - before anything runs, not as an undefined three calls later.
//
// Server variables stay on the server. A variable the browser may read has
// to start with PUBLIC_, and is read from import.meta.env, which is what Vite
// exposes there. Add a variable: one line in the schema, and every reader is
// typed.
const processEnv: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env

export const env = createEnv({
  server: {
    NODE_ENV: ${lib.opt},
    // DATABASE_URL: ${lib.url},
    // SESSION_SECRET: ${lib.str},
  },
  clientPrefix: 'PUBLIC_',
  client: {
    // PUBLIC_SITE_URL: ${lib.url},
  },
  // process is the server's; a "use client" file importing this for a
  // PUBLIC_ value has only import.meta.env, and Vite fills the PUBLIC_ ones.
  runtimeEnv: { ...processEnv, ...import.meta.env },
  emptyStringAsUndefined: true,
  // A build machine without the production variables: SKIP_ENV_VALIDATION=1
  // builds anyway, and the server that runs the build validates at startup.
  skipValidation: !!processEnv.SKIP_ENV_VALIDATION,
})
`
}

/**
 * The process bootstrap, written when the app validates its environment.
 *
 * env.ts refuses at import - and where that import happens decides who sees
 * the refusal. Imported by the first page that needs a variable, a missing
 * one is reported by that page, to that visitor, after the server said it
 * was up. Imported here, the generated entry evaluates this file before any
 * page module and awaits register() before the first request, so a server
 * with a bad environment does not start. Next names the file the same.
 */
export function instrumentation(_o: Options): string {
  return `// Runs once, before anything else: on a server at startup, on a Worker
// when its first request arrives. The entry imports this file first, so a
// package configured here is configured before any page module evaluates.
//
// env.ts validates on import. Importing it here means a missing variable
// stops the server from starting rather than reaching a visitor as a page
// that fails three calls later.
import './env'

// Anything asynchronous the app needs before its first request - warming a
// connection, checking a migration - goes here. The first render waits for
// it. Read environment inside this function, not at the top of the module,
// if the app deploys to a Worker: a binding is only readable once a request
// has arrived.
export async function register() {}
`
}

/**
 * The two lines that wire a backend: where host calls go, and the secret it
 * checks. Written when the project has a backend answering them - a Go
 * server, or anything speaking the contract - so the renderer needs no
 * configuring in development or in production. A Laravel app has both in
 * its .env already, under APP_URL.
 */
export function backendEnv(backend: string, secret: string): string {
  return `# Where rpc() goes: a backend answering POST /__rsc/host-call. The renderer
# reads both of these, in development (vite) and in production (the built
# server). The backend checks the secret on every call; keep it out of git.
RSC_BACKEND=${backend}
RSC_HOST_CALL_SECRET=${secret}
`
}

export function backendEnvExample(backend: string): string {
  return `# Copy to .env. The backend answering rpc(), and the secret it checks -
# generate one: openssl rand -base64 32
RSC_BACKEND=${backend}
RSC_HOST_CALL_SECRET=
`
}

/**
 * What the backend has to do, said once at the end. Go gets its own, because
 * the project said it was Go; anything else gets the contract.
 */
export function backendStep(go: boolean): string {
  if (go) {
    return [
      'answer host calls from your Go server - go get github.com/rsc-kit/go, then:',
      '',
      '    reg := rsckit.NewRegistry()',
      '    reg.Register("Orders.recent", func(ctx context.Context, args rsckit.Args) (any, error) { … })',
      '    callback, _ := rsckit.NewCallbackHandler(reg, os.Getenv("RSC_HOST_CALL_SECRET"))',
      '    mux.Handle("POST /__rsc/host-call", callback)',
      '',
      '  A page reads it with await rpc(\'Orders.recent\'). https://rsc-kit.dev/hosts/go',
    ].join('\n')
  }

  return [
    'answer POST /__rsc/host-call from your backend, checking X-Rsc-Host-Secret',
    '  against RSC_HOST_CALL_SECRET in .env. The contract: https://rsc-kit.dev/hosts/your-own-backend',
  ].join('\n')
}

/** The example beside it - the one file that is committed. */
export const envExample = `# Copy to .env and fill in. Server variables never reach the browser;
# a browser-readable one starts with PUBLIC_. The schema is src/env.ts.
#
# Not NODE_ENV. Vite sets it - development under \`vite\`, production under
# \`vite build\` - and a value written here overrides that: NODE_ENV=development
# in .env makes a production build emit React's development JSX runtime,
# which the production server does not have, and every page fails to render.
# DATABASE_URL=
# SESSION_SECRET=
# PUBLIC_SITE_URL=
`
