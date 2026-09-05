// Adding RSC to a project that already exists.
//
// Scaffolding writes whatever it likes into an empty directory. This cannot:
// the vite config, the server and package.json are already someone's, and they
// are the three files most likely to hold work that took a while to get right.
//
// So the rule here is that nothing existing is ever rewritten. New files are
// written, missing dependencies are added, and for anything already present
// the exact edit is printed for the reader to make. A tool that silently
// reformats a working server has to be right about more than it can know.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { cwd, exit, stdout } from 'node:process'

import { DEFAULT_COMPILER, parseArgs } from './options.js'
import { Prompter, bold, cyan, dim } from './prompt.js'

import type { Host, Options } from './options.js'
import * as t from './templates.js'

export interface Detected {
  /** What the project's package.json says it already depends on. */
  deps: Record<string, string>
  host: Host | null
  sourceDir: string | null
  viteConfig: string | null
  hasReact: boolean
  hasTailwind: boolean
  hasTypeScript: boolean
  packageJson: Record<string, unknown>
}

/** What a step did, for the report at the end. */
export interface Step {
  kind: 'wrote' | 'merged' | 'manual' | 'skipped'
  what: string
  detail?: string
}

const HOST_PACKAGES: Record<string, Host> = { hono: 'hono', elysia: 'elysia' }

/**
 * What is already here.
 *
 * Every answer is a guess the caller can override — the point is to not ask
 * about things the project has already decided.
 */
export function detect(dir: string): Detected {
  const pkgPath = join(dir, 'package.json')
  const packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>

  const deps: Record<string, string> = {
    ...((packageJson.dependencies as Record<string, string>) ?? {}),
    ...((packageJson.devDependencies as Record<string, string>) ?? {}),
  }

  let host: Host | null = null

  for (const [pkg, value] of Object.entries(HOST_PACKAGES)) {
    if (deps[pkg]) host = value
  }

  // No framework named, so it comes down to which runtime's types are here.
  // Bun is the default because a project with neither is more likely to be
  // reaching for this from Bun than from bare node:http.
  if (!host) host = deps['@types/node'] && !deps['@types/bun'] ? 'node' : 'bun'

  return {
    deps,
    host,
    sourceDir: ['src', 'app', 'resources/js'].find((d) => existsSync(join(dir, d))) ?? null,
    viteConfig: ['vite.config.ts', 'vite.config.js', 'vite.config.mts'].find((f) =>
      existsSync(join(dir, f)),
    ) ?? null,
    hasReact: Boolean(deps.react),
    hasTailwind: Boolean(deps.tailwindcss),
    hasTypeScript: existsSync(join(dir, 'tsconfig.json')),
    packageJson,
  }
}

/**
 * Add the dependencies the engine needs, without touching versions already
 * chosen. A project on React 19.3 does not want to be pinned back to ours.
 */
function mergeDependencies(o: Options, found: Detected): Step[] {
  const pkg = found.packageJson
  const wanted = JSON.parse(t.packageJson(o)) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }

  const steps: Step[] = []
  const added: string[] = []

  for (const [field, incoming] of [
    ['dependencies', wanted.dependencies],
    ['devDependencies', wanted.devDependencies],
  ] as const) {
    const current = (pkg[field] as Record<string, string>) ?? {}

    for (const [name, range] of Object.entries(incoming)) {
      // Already declared anywhere: leave it exactly as it is.
      if (found.deps[name]) continue

      current[name] = range
      added.push(name)
    }

    if (Object.keys(current).length > 0) {
      pkg[field] = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)))
    }
  }

  steps.push(
    added.length > 0
      ? { kind: 'merged', what: 'package.json', detail: `added ${added.join(', ')}` }
      : { kind: 'skipped', what: 'package.json dependencies', detail: 'everything needed is already here' },
  )

  return steps
}

/**
 * Scripts, but never over one that exists.
 *
 * `dev` and `build` are the two most likely to already mean something, and
 * quietly replacing either is how a tool loses someone's trust permanently.
 */
function mergeScripts(o: Options, found: Detected): Step[] {
  const pkg = found.packageJson
  const scripts = (pkg.scripts as Record<string, string>) ?? {}
  const wanted = (JSON.parse(t.packageJson(o)) as { scripts: Record<string, string> }).scripts

  const added: string[] = []
  const conflicts: string[] = []

  for (const [name, command] of Object.entries(wanted)) {
    if (scripts[name] === undefined) {
      scripts[name] = command
      added.push(name)
    } else if (scripts[name] !== command) {
      conflicts.push(`${name}: ${command}`)
    }
  }

  pkg.scripts = scripts

  const steps: Step[] = []

  if (added.length > 0) steps.push({ kind: 'merged', what: 'scripts', detail: added.join(', ') })

  if (conflicts.length > 0) {
    steps.push({
      kind: 'manual',
      what: 'scripts you already have',
      detail: `left alone — add these yourself if you want them:\n      ${conflicts.join('\n      ')}`,
    })
  }

  return steps
}

/** The plugin entry, written if there is no config and printed if there is. */
function viteConfig(o: Options, found: Detected, dir: string): Step[] {
  if (found.viteConfig === null) {
    writeFileSync(join(dir, 'vite.config.ts'), t.viteConfig(o))

    return [{ kind: 'wrote', what: 'vite.config.ts' }]
  }

  return [
    {
      kind: 'manual',
      what: found.viteConfig,
      detail:
        `add the plugin — it must come before any react() layer:\n` +
        `      import { rscRoutes } from '@rsc-kit/core/vite'\n\n` +
        `      plugins: [\n` +
        `        rscRoutes({ sourceDir: '${o.sourceDir}', outDir: 'build', assetsDir: 'build/public' }),\n` +
        `        …whatever you already have\n` +
        `      ]`,
    },
  ]
}

/** The server: written only when there is nothing there to break. */
function server(o: Options, dir: string): Step[] {
  const file = t.serverFile(o.host)

  if (existsSync(join(dir, file))) {
    return [
      {
        kind: 'manual',
        what: file,
        detail:
          'left alone. Mount the handler in it — anything the route table does not\n' +
          '      claim comes back null, so your own routes still win:\n\n' +
          t
            .server(o.host)
            .split('\n')
            .map((line) => '      ' + line)
            .join('\n'),
      },
    ]
  }

  writeFileSync(join(dir, file), t.server(o.host))

  return [{ kind: 'wrote', what: file }]
}

/** The route tree, only where there is not one already. */
function routes(o: Options, dir: string): Step[] {
  const appDir = join(dir, o.sourceDir, 'app')
  const steps: Step[] = []

  if (existsSync(join(appDir, 'layout.tsx')) || existsSync(join(appDir, 'page.tsx'))) {
    return [{ kind: 'skipped', what: `${o.sourceDir}/app`, detail: 'a route tree is already here' }]
  }

  const files: [string, string][] = [
    [join(o.sourceDir, 'app/layout.tsx'), t.layout(o)],
    [join(o.sourceDir, 'app/page.tsx'), t.page(o)],
    [join(o.sourceDir, 'components/Counter.tsx'), t.counter(o)],
  ]

  if (o.tailwind) files.push([join(o.sourceDir, 'app/styles.css'), t.styles])

  for (const [path, contents] of files) {
    const full = join(dir, path)

    if (existsSync(full)) {
      steps.push({ kind: 'skipped', what: path, detail: 'already exists' })
      continue
    }

    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, contents)
    steps.push({ kind: 'wrote', what: path })
  }

  return steps
}

/** Ignore the files the build rewrites into the source dir on every run. */
function gitignore(o: Options, dir: string): Step[] {
  const path = join(dir, '.gitignore')
  const generated = ['rsc-env.d.ts', 'rsc-types.d.ts', 'rsc-routes.d.ts', 'rsc-engine.d.ts'].map(
    (f) => `${o.sourceDir}/${f}`,
  )

  const current = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  const missing = generated.filter((line) => !current.includes(line))

  if (missing.length === 0) return [{ kind: 'skipped', what: '.gitignore', detail: 'already covers the generated files' }]

  writeFileSync(
    path,
    current + (current.endsWith('\n') || current === '' ? '' : '\n') +
      '\n# Written into the source dir by the RSC build, every run.\n' +
      missing.join('\n') + '\nbuild\n',
  )

  return [{ kind: 'merged', what: '.gitignore', detail: `added ${missing.length} generated paths` }]
}

/** Everything, in the order a reader would want to hear about it. */
export function initialise(o: Options, found: Detected, dir: string): Step[] {
  const steps = [
    ...routes(o, dir),
    ...viteConfig(o, found, dir),
    ...server(o, dir),
    ...gitignore(o, dir),
    ...mergeDependencies(o, found),
    ...mergeScripts(o, found),
  ]

  writeFileSync(join(dir, 'package.json'), JSON.stringify(found.packageJson, null, 2) + '\n')

  return steps
}


const INIT_HELP = `
  rsc-kit init — add RSC to the project in this directory

  Nothing existing is ever rewritten. New files are written, missing
  dependencies are added, and for anything already there the exact edit is
  printed for you to make.

  Options
    --source-dir <dir>   where app/ should live (detected, usually src)
    --host=…             bun | hono | elysia | node (detected from your deps)
    --compiler=…         none | oxc | babel
    --tailwind           add Tailwind as well
    -y, --yes            accept what was detected, ask nothing
    -h, --help           this
`

/**
 * Add RSC to a project that already exists.
 *
 * Almost everything is detected rather than asked: which server the project
 * already uses, where its source lives, whether React and Tailwind are already
 * there. A question about something the project has already decided is a
 * question with a wrong answer available.
 */
export async function runInit(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    stdout.write(INIT_HELP)

    return
  }

  const dir = cwd()

  if (!existsSync(join(dir, 'package.json'))) {
    stdout.write(
      `\n${bold('No package.json here.')}\n` +
        `  init adds RSC to a project that already exists. To start a new one:\n` +
        `  ${cyan('bun create rsc-kit my-app')}\n\n`,
    )
    exit(1)
  }

  const flags = parseArgs(args)
  const found = detect(dir)
  const unattended = args.includes('-y') || args.includes('--yes') || flags.host !== undefined

  stdout.write(`\n${bold('Adding rsc-kit')} ${dim(dir)}\n\n`)
  stdout.write(`  ${dim('server')}      ${found.host}${flags.host ? '' : dim('  (detected)')}\n`)
  stdout.write(`  ${dim('source')}      ${flags.sourceDir ?? found.sourceDir ?? 'src'}\n`)
  stdout.write(`  ${dim('react')}       ${found.hasReact ? 'already here' : 'will be added'}\n\n`)

  let compiler = flags.compiler ?? 'none'
  let tailwind = flags.tailwind ?? found.hasTailwind

  if (!unattended) {
    const p = new Prompter()

    try {
      compiler = flags.compiler ?? ((await p.confirm('React Compiler', true)) ? DEFAULT_COMPILER : 'none')
      if (flags.tailwind === undefined && !found.hasTailwind) {
        tailwind = await p.confirm('Tailwind CSS', false)
      }
    } finally {
      p.close()
    }
  }

  const options = {
    dir,
    name: 'app',
    host: flags.host ?? found.host ?? 'bun',
    compiler,
    tailwind,
    lint: false,
    sourceDir: flags.sourceDir ?? found.sourceDir ?? 'src',
    install: false,
    git: false,
    core: flags.core ?? '^0.1.0',
  }

  const steps = initialise(options, found, dir)

  const mark = { wrote: cyan('+'), merged: cyan('~'), manual: bold('!'), skipped: dim('·') }

  stdout.write(`${bold('Done.')}\n\n`)

  for (const step of steps) {
    stdout.write(`  ${mark[step.kind]} ${step.what}${step.detail ? dim('  — ' + step.detail) : ''}\n`)
  }

  const manual = steps.filter((s) => s.kind === 'manual')

  stdout.write(
    manual.length > 0
      ? `\n${bold('Then, by hand:')} the edits marked ! above are in files you already had.\n\n`
      : `\n  ${cyan('bun install')} and you are ready.\n\n`,
  )
}
