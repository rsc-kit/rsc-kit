#!/usr/bin/env node
// The commands an app runs but should not have to own.
//
// `prerender` was a script every app copied: eleven lines of importing its own
// build output, clearing a directory and printing a table. Nothing in it was
// the app's decision, and a copy in every project is a copy that goes stale
// against the engine that produced it.
//
// What stays in the app is the server, because that genuinely differs, and
// export.ts when a site wants one, because where it writes is a real choice.

import { rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { argv, cwd, exit, stdout } from 'node:process'

import { prerender } from './prerender.js'
import { writeTo } from './files.js'

const HELP = `
  rsc-router — commands for an app built with @rsc-router/core

  Usage
    rsc-router prerender [options]

  Options
    --out <dir>      where the build wrote its bundles (default: .rsc)
    --static <dir>   where to put the frozen pages (default: <out>/static)
    -h, --help       this

  Run it after a build. Every page is attempted; a page that reaches for
  request data at render time says so by doing it, and is left to render on
  demand.
`

const args = argv.slice(2)
const command = args[0]

if (!command || command === '--help' || command === '-h') {
  stdout.write(HELP)
  exit(command ? 0 : 1)
}

const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)

  return i === -1 ? undefined : args[i + 1]
}

if (command === 'prerender') {
  await runPrerender()
} else {
  stdout.write(`\n  Unknown command: ${command}\n${HELP}`)
  exit(1)
}

async function runPrerender(): Promise<void> {
  // Set before the engine is loaded, not by the caller. React's server build
  // branches on this at module evaluation, so a production bundle evaluated
  // without it behaves as a development one — which is why every app used to
  // carry NODE_ENV in its scripts.
  process.env.NODE_ENV ??= 'production'

  const out = resolve(cwd(), flag('out') ?? '.rsc')
  const staticDir = resolve(cwd(), flag('static') ?? join(out, 'static'))
  const bundle = join(out, 'dist/rsc/index.js')

  if (!existsSync(bundle)) {
    stdout.write(
      `\n  No build at ${bundle}.\n` +
        `  Run the build first, or pass --out if it writes somewhere else.\n\n`,
    )
    exit(1)
  }

  // Imported after NODE_ENV is set, which a static import could not be.
  const engine = (await import(bundle)) as never

  // Cleared first: a route that changes classification between builds
  // otherwise leaves its old shell on disk and the host goes on serving it.
  // Nothing warns — the page loads, with content from the previous build.
  await rm(staticDir, { recursive: true, force: true })

  const mark: Record<string, string> = { frozen: '○', shell: '◔', error: '✗' }

  const results = await prerender({
    engine,
    write: writeTo(staticDir),
    onResult: (r) => {
      stdout.write(`  ${mark[r.type] ?? ' '}  ${r.url}${r.reason ? `  (${r.reason})` : ''}\n`)

      if (r.warning) stdout.write(`     ⚠  ${r.warning}\n`)
    },
  })

  const count = (type: string) => results.filter((r) => r.type === type).length

  stdout.write(`
  ○  the whole page is stored
  ◔  the chrome is stored; the rest is rendered per request

${count('frozen')} stored, ${count('shell')} shells\n`)

  if (count('error') > 0) exit(1)
}
