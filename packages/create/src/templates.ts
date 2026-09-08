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
  /** Where browser assets are written. */
  assetsDir: string
  /** The url they are served under, when it is not Vite's default. */
  assetsUrl?: string
  /** Written while the dev server runs, for a backend that has to find it. */
  hotFile?: string
}

/**
 * Where this host's build writes, and where its server reads.
 *
 * One function because the two have to agree and nothing checks that they do:
 * an assetsDir the server does not serve 404s every asset while every page
 * still renders, so the page looks right and nothing hydrates. Laravel's
 * differ from the rest because public/ is already the browser's root and
 * bootstrap/ is already where a Laravel app keeps generated code.
 */
export function paths(o: Options): Paths {
  if (o.host !== 'laravel') {
    return { sourceDir: o.sourceDir, outDir: 'build', assetsDir: 'build/public' }
  }

  return {
    sourceDir: o.sourceDir,
    outDir: 'bootstrap/rsc/vite',
    assetsDir: 'public/build/rsc-vite',
    assetsUrl: '/build/rsc-vite/',
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
  const run = o.host === 'node' ? 'node' : 'bun run'
  const p = paths(o)

  if (o.host === 'laravel') {
    const config = `--config ${configFile(o)}`
    // The build cannot discover the app's server actions — reflection through
    // Composer's autoloader is the only thing that sees what a class inherits
    // from its parents and traits — so PHP writes them out first and the
    // plugin reads the file. Part of the command rather than a step to
    // remember: a stale map names a method that has since been renamed, and
    // nothing fails until the browser calls it.
    const actions = 'php artisan rsc:action-manifest'

    return {
      // The ordinary names. A Laravel application already has `dev` and
      // `build`, and init combines rather than replaces — the stock ones run
      // the asset pipeline, and both pipelines belong to `npm run dev`.
      // Only a script somebody actually wrote gets left alone, and then the
      // RSC one takes an `rsc:` name and says so.
      dev: `${actions} && vite ${config}`,
      build: `${actions} && vite build ${config}`,
      start: `${run} ${serverFile(o.host)}`,
    }
  }

  return {
    // Vite serves it: modules are re-evaluated on edit, and adding a
    // page restarts to pick up the new route table. Nothing is prebuilt,
    // so there is no NODE_ENV to keep in step with a build.
    dev: 'vite',
    build: 'vite build',
    start: `${run} ${serverFile(o.host)}`,
    // No prerender script. `vite build` freezes every page it can already, and
    // a standalone one named a CLI the app does not depend on — `rsc-kit`, not
    // `@rsc-kit/core` — so it exited 127 in every project ever created from
    // this template. Redoing the freeze without a rebuild is still possible
    // with `bunx rsc-kit prerender`; it is not worth a dependency to shorten.
  }
}

export function packageJson(o: Options): string {
  const deps: Record<string, string> = {
    '@rsc-kit/core': o.core,
    react: '^19.2.5',
    'react-dom': '^19.2.5',
  }

  if (o.host === 'hono') deps.hono = '^4.13.5'
  if (o.host === 'elysia') deps.elysia = '^1.4.30'

  const dev: Record<string, string> = {
    '@types/react': '^19.2.18',
    '@types/react-dom': '^19.2.7',
    typescript: '^7.0.2',
    vite: '^8.1.5',
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

  const p = paths(o)

  // Every path the build writes to, and the two the server has to agree with.
  // Written out rather than defaulted so they are editable in one place — and
  // so the pair that has no error case, assetsDir and assetsUrl, is visible
  // together.
  const options = [
    `sourceDir: '${p.sourceDir}'`,
    `outDir: '${p.outDir}'`,
    `assetsDir: '${p.assetsDir}'`,
    ...(p.assetsUrl ? [`assetsUrl: '${p.assetsUrl}'`] : []),
    ...(p.hotFile ? [`hotFile: '${p.hotFile}'`] : []),
  ]

  plugins.push(`rscKit({
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

/**
 * A type for the bundle `vite build` writes, which does not exist yet.
 *
 * server.ts imports it statically, and that is deliberate: a bundler decides
 * what to embed by tracing static specifiers, so resolving the path at runtime
 * instead leaves the engine out. Measured on a scaffolded app — the same server
 * bundles to 801 KB with the import and 27 KB without it, and the compiled
 * binary cannot start.
 *
 * The cost is that a project which has never been built shows an unresolved
 * import on the one line of server.ts that matters, before its author has done
 * anything wrong. This answers that.
 *
 * A fallback, not a shadow. Once the build exists TypeScript resolves the real
 * file and ignores this, so a path that is genuinely wrong still fails — and
 * before the build the engine is typed as RscEngine rather than the `any` an
 * untyped .js resolves to afterwards.
 */
export const buildTypes = (): string =>
  `declare module '*/dist/rsc/index.js' {
  const engine: import('@rsc-kit/core/host').RscEngine
  export = engine
}
`

export const BUILD_TYPES_FILE = 'rsc-build.d.ts'

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
        types: o.host === 'node' ? ['node', 'vite/client'] : ['@types/bun', 'vite/client'],
      },
      include: [`${o.sourceDir}/**/*`, serverFile(o.host), BUILD_TYPES_FILE],
    },
    null,
    2,
  ) + '\n'


const HANDLER = `const rsc = createRscHandler({
  engine,
  assets: assetsFrom('./build/public'),
  // Served from disk when a page was frozen at build time; rendered now when
  // it was not.
  prerendered: prerenderedFrom('./build/static'),
})`

const IMPORTS = `import { createRscHandler } from '@rsc-kit/core/host'
import { assetsFrom, prerenderedFrom } from '@rsc-kit/core/files'

// Statically imported, not \`import(variable)\`: a bundler cannot see through a
// variable, so \`bun build --compile\` would leave the engine out of the binary.
//
// No NODE_ENV to set before it. The build bakes the mode it ran in into the
// bundle, so this server is production because it was built that way — not
// because whoever started it remembered to say so.
import * as engine from './build/dist/rsc/index.js'`

/**
 * The renderer for an app whose data lives in PHP.
 *
 * Different in kind from the others, not just in wiring: those servers ARE the
 * application, and this one renders for an application it talks to. Every
 * rpc() a server component makes leaves this process as a POST carrying the
 * visitor's own cookie, so the session, the user and the authorization are
 * Laravel's — this side holds no database connection and no session.
 *
 * Only production runs it. In development `vite` is the renderer, and Laravel
 * finds it through the hot file.
 */
function backedServer(o: Options): string {
  const p = paths(o)
  const backend = o.backend ?? 'http://localhost'

  return `// The renderer for this app.
//
// It owns routing, rendering, prerendered pages and assets. Laravel owns the
// data: every rpc() a server component makes arrives there as a POST, with
// this visitor's cookie, and comes back as JSON.
//
// Run it beside Laravel:
//   bun server.ts
//
// Both processes need the same RSC_HOST_CALL_SECRET. Nothing else is shared.

import { createBackedHandler } from '@rsc-kit/core/serve'
import * as engine from './${p.outDir}/dist/rsc/index.js'

const secret = process.env.RSC_HOST_CALL_SECRET
// Where host calls go: the application this is rendering for.
const backend = process.env.RSC_BACKEND ?? '${backend}'
const port = Number(process.env.RSC_RENDERER_PORT ?? 5173)

// Refused rather than defaulted. An empty secret is a host-call endpoint that
// answers to anyone who can reach it, and it would fail nowhere until then.
if (!secret) {
  console.error('RSC_HOST_CALL_SECRET must match the one Laravel is configured with.')
  process.exit(1)
}

const handle = createBackedHandler({
  engine,
  // The browser's root, and the prefix the build serves assets under. Passing
  // the asset folder itself 404s every asset while every page still renders —
  // so the page looks right and nothing hydrates.
  assetsDir: 'public',
  assetsPrefix: '${p.assetsUrl}',
  // Where the build's prerender writes.
  prerenderedDir: '${p.outDir}/static',
  hostCall: {
    endpoint: \`\${backend}/__rsc/host-call\`,
    secret,
  },
  // Compared by the client on every navigation, which falls back to a full
  // load when it changes. Without one a browser keeps talking to a deployment
  // that no longer exists.
  version: process.env.RSC_BUILD_VERSION,

  // A page reading \`params\` gets its url params from the engine; the query
  // string is merged in here, because a page asking for \`params.q\` should get
  // it whether it arrived in the path or after the ?.
  //
  // Read from the url rather than fetched: a page needing more than the
  // request carries — a loaded record, a tenant — asks for it with a host
  // call, because this process has no database.
  props: (match, request) => ({
    ...match.params,
    ...Object.fromEntries(new URL(request.url).searchParams),
  }),
})

Bun.serve({
  port,
  // Named explicitly. The default binds IPv6 only on some machines, so the
  // renderer answers on localhost and ::1 but not on 127.0.0.1 — which reads
  // as the process being down.
  hostname: process.env.RSC_RENDERER_HOST ?? '127.0.0.1',
  idleTimeout: 60,
  fetch: async (request) => (await handle(request)) ?? new Response('Not found', { status: 404 }),
})

console.log(\`renderer on http://127.0.0.1:\${port}, calling \${backend}\`)
`
}

export function server(o: Options): string {
  const host = o.host

  if (host === 'laravel') return backedServer(o)

  if (host === 'bun') {
    return `${IMPORTS}

${HANDLER}

Bun.serve({
  port: ${PORT},
  // Anything the route manifest does not claim comes back null and is yours.
  fetch: async (request) => (await rsc(request)) ?? new Response('Not found', { status: 404 }),
})

console.log('http://localhost:${PORT}')
`
  }

  if (host === 'hono') {
    return `import { Hono } from 'hono'
${IMPORTS}

${HANDLER}

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))
// Last, so the app's own routes win; anything left falls through to the RSC
// handler, and anything it does not claim is a real 404.
app.all('*', async (c) => (await rsc(c.req.raw)) ?? c.notFound())

export default { port: ${PORT}, fetch: app.fetch }
`
  }

  if (host === 'elysia') {
    return `import { Elysia } from 'elysia'
${IMPORTS}

${HANDLER}

new Elysia()
  .get('/health', () => ({ ok: true }))
  .all('*', async ({ request, status }) => (await rsc(request)) ?? status(404, 'Not found'))
  .listen(${PORT})

console.log('http://localhost:${PORT}')
`
  }

  return `import { createServer } from 'node:http'
import { Readable } from 'node:stream'
${IMPORTS}

${HANDLER}

// Node exits on an unhandled rejection; Bun logs one and carries on. That
// difference is reachable from outside: a malformed body posted to
// /_rsc/action fails inside React's Flight decoder, in a promise nobody
// awaits, so no try/catch here can see it — and on Node the process dies.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled rejection]', reason)
})

const server = createServer(async (req, res) => {
  const url = \`http://\${req.headers.host ?? 'localhost'}\${req.url ?? '/'}\`
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'

  const request = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    // A server action posts binary. Streaming rather than buffering keeps an
    // upload from being held twice; \`duplex\` is required for a stream body.
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)

  let response: Response

  try {
    response = (await rsc(request)) ?? new Response('Not found', { status: 404 })
  } catch (error) {
    console.error('[rsc]', error)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Internal Server Error')

    return
  }

  res.writeHead(response.status, Object.fromEntries(response.headers))

  if (!response.body) {
    res.end()

    return
  }

  // Piped, not buffered: reading it to a string first would hold the whole
  // page before sending any of it, which is the streaming this exists to do
  // thrown away in the last three lines.
  Readable.fromWeb(response.body as never).pipe(res)
})

server.listen(${PORT}, () => console.log('http://localhost:${PORT}'))
`
}


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
