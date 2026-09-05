// The files a new app gets.
//
// Kept as strings rather than a copied directory on purpose: the choices cross
// each other — the compiler changes vite.config, Tailwind changes it and the
// layout — and a template directory would need one copy per combination.

import type { Compiler, Host, Options } from './options.js'

const PORT = 3000

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

  const run = o.host === 'node' ? 'node' : 'bun run'

  return (
    JSON.stringify(
      {
        name: o.name,
        type: 'module',
        private: true,
        scripts: {
          // Vite serves it: modules are re-evaluated on edit, and adding a
          // page restarts to pick up the new route table. Nothing is prebuilt,
          // so there is no NODE_ENV to keep in step with a build.
          dev: 'vite',
          build: 'vite build',
          start: `${run} ${serverFile(o.host)}`,
          prerender: 'rsc-kit prerender --out build',
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

  imports.push("import { rscRoutes } from '@rsc-kit/core/vite'")

  plugins.push(`rscRoutes({
      sourceDir: 'src',
      outDir: 'build',
      assetsDir: 'build/public',
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
        skipLibCheck: true,
        resolveJsonModule: true,
        types: o.host === 'node' ? ['node', 'vite/client'] : ['@types/bun', 'vite/client'],
      },
      include: [`${o.sourceDir}/**/*`, serverFile(o.host)],
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

export function server(host: Host): string {
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

\`${pm} prerender\` re-runs only the freezing part, for when you turned it off
in \`vite.config.ts\` or want to redo it without rebuilding.

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
