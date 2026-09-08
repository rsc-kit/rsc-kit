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
 * The config the RSC build runs, which for Laravel is not the app's own.
 *
 * A Laravel application already has a vite.config with laravel-vite-plugin in
 * it, and the two cannot share one: both set an input list, an outDir and a
 * hot file, and whichever plugin runs second wins. So the RSC build gets its
 * own file and the scripts name it, rather than an install that quietly breaks
 * the asset pipeline the app was already using.
 */
export const configFile = (o: Options): string =>
  o.host === 'laravel' ? 'vite.rsc.config.ts' : 'vite.config.ts'

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
    const config = `--config ${configFile(o)}`
    const actions = 'php artisan rsc:action-manifest'

    return {
      // The ordinary names. A Laravel application already has `dev` and
      // `build`, and init combines rather than replaces — the stock ones run
      // the asset pipeline, and both pipelines belong to `npm run dev`.
      dev: `${actions} && vite ${config}`,
      build: `${actions} && vite build ${config}`,
      // What the build wrote. There is no server file to start any more.
      start: 'bun .output/server/index.mjs',
    }
  }

  return {
    dev: 'vite',
    build: 'vite build',
    ...(o.host === 'worker'
      ? { preview: 'wrangler dev .output/server/index.mjs', deploy: 'nitro deploy --prebuilt' }
      : {
          start: `${o.host === 'node' ? 'node' : 'bun'} .output/server/index.mjs`,
          // Bun only, and only because serveStatic: 'inline' is set in the vite
          // config. Without that the binary compiles, serves pages, and 404s
          // every asset — the static path resolves into Bun's virtual
          // filesystem, where the files on disk are not.
          ...(o.host === 'bun'
            ? { compile: `bun build --compile .output/server/index.mjs --outfile ${o.name}` }
            : {}),
        }),
    typecheck: 'tsc --noEmit',
    ...(o.lint ? { lint: 'oxlint src --fix', 'lint:check': 'oxlint src --deny-warnings' } : {}),
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
      ? { wrangler: '^4.0.0', '@cloudflare/workers-types': '^4.0.0' }
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

  return (
    JSON.stringify(
      {
        name: o.name,
        type: 'module',
        private: true,
        scripts: {
          ...scripts(o),
          typecheck: 'tsc --noEmit',
          ...(o.lint
            ? { lint: 'oxlint src --fix', 'lint:check': 'oxlint src --deny-warnings' }
            : {}),
        },
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
  plugins.push(`nitro({ preset: ${JSON.stringify(preset(o.host))}, serveStatic: 'inline' })`)
  plugins.push(`rscKit({
      nitro: true,
      ${options.join(',\n      ')},
    })`)

  plugins.push(o.compiler === 'oxc' ? 'react({ compiler: true })' : 'react()')

  if (o.compiler === 'babel') plugins.push('babel({ presets: [reactCompilerPreset()] })')
  if (o.tailwind) plugins.push('tailwindcss()')

  return `${imports.join('\n')}

export default defineConfig({
  plugins: [
    ${plugins.join(',\n    ')},
  ],
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
            ? // A Worker has neither node globals nor Bun's. Its own types, and
              // vite/client for import.meta.env.
              ['@cloudflare/workers-types', 'vite/client']
            : o.host === 'node'
              ? ['node', 'vite/client']
              : ['@types/bun', 'vite/client'],
      },
      include: [`${o.sourceDir}/**/*`],
    },
    null,
    2,
  ) + '\n'


export function layout(o: Options): string {
  return `${o.tailwind ? "import './styles.css'\n" : ''}import type { ReactNode } from 'react'

export const metadata = {
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

export function page(o: Options): string {
  const h1 = o.tailwind ? ' className="text-3xl font-bold"' : ''
  const p = o.tailwind ? ' className="mt-4 text-slate-600"' : ''

  return `import { Counter } from '../components/Counter'

export const metadata = { title: 'Home' }

// A server component: async, runs only on the server, ships no JavaScript.
export default async function HomePage() {
  const now = new Date().toISOString()

  return (
    <>
      <h1${h1}>${o.name}</h1>
      <p${p}>
        Rendered on the server at {now}. The only JavaScript on this page is the
        counter below.
      </p>

      <Counter />
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
.rsc
dist
*.log
.DS_Store

# Written by the build into the source dir, every run.
src/rsc-env.d.ts
src/rsc-types.d.ts
src/rsc-routes.d.ts
src/rsc-engine.d.ts
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

export function readme(o: Options): string {
  const pm = o.host === 'node' ? 'npm run' : 'bun run'

  return `# ${o.name}

React Server Components on ${o.host === 'node' ? 'node:http' : o.host === 'bun' ? 'Bun.serve' : o.host}.

\`\`\`sh
${pm} dev         # vite — serves from source, no build step
${pm} build       # bundles, then freezes every page it can
${pm} start       # serve on http://localhost:${PORT}
\`\`\`

Freezing is part of \`build\`. To redo it against fresh data without
rebuilding — or after turning it off in \`vite.config.ts\` — run
\`bunx rsc-kit prerender --out ${paths(o).outDir}\`, keeping that package's version in
step with \`@rsc-kit/core\`.

## Where things go

    src/app/layout.tsx    the root layout; owns <html>
    src/app/page.tsx      /
    src/app/about/page.tsx  /about
    src/components/       client components ("use client")

A directory with a \`page.tsx\` is a route. \`[slug]\` is a parameter,
\`middleware.ts\` runs before anything at or below it renders.

Docs: https://github.com/ramonmalcolm/rsc-kit
`
}
