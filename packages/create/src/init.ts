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

import { DEFAULT_COMPILER, parseArgs, publishedCore } from './options.js'
import { Prompter, bold, cyan, dim } from './prompt.js'

import type { Host, Options } from './options.js'
import * as t from './templates.js'

export interface Detected {
  /** What the project's package.json says it already depends on. */
  deps: Record<string, string>
  /** A Laravel application: artisan and a composer manifest, both. */
  laravel: boolean
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

  // Both files, not either: `artisan` alone is a name anything could use, and
  // a composer.json alone is any PHP project. Together they are Laravel, and
  // the check costs nothing to be sure about.
  const laravel = existsSync(join(dir, 'artisan')) && existsSync(join(dir, 'composer.json'))

  let host: Host | null = laravel ? 'laravel' : null

  for (const [pkg, value] of Object.entries(HOST_PACKAGES)) {
    if (!laravel && deps[pkg]) host = value
  }

  // No framework named, so it comes down to which runtime's types are here.
  // Bun is the default because a project with neither is more likely to be
  // reaching for this from Bun than from bare node:http.
  if (!host) host = deps['@types/node'] && !deps['@types/bun'] ? 'node' : 'bun'

  return {
    deps,
    laravel,
    host,
    // Its own directory under resources/js rather than resources/js itself: a
    // Laravel app already keeps its asset entry points there, and a route tree
    // rooted at that directory would make app.js a page.
    sourceDir: laravel
      ? 'resources/js/rsc'
      : ['src', 'app', 'resources/js'].find((d) => existsSync(join(dir, d))) ?? null,
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
 * The major a range starts at, or null when it is not one.
 *
 * Deliberately crude — `file:` specs, `latest`, `workspace:*` and git urls all
 * come back null and are left alone. It only has to answer one question, and
 * only where the answer is unambiguous.
 */
function major(range: string): number | null {
  const match = /^\D*(\d+)\./.exec(range)

  return match ? Number(match[1]) : null
}

/**
 * Add the dependencies the engine needs, without touching versions already
 * chosen. A project on React 19.3 does not want to be pinned back to ours.
 *
 * Except when what is already there is too OLD, which is not the same thing
 * and is the common case here: every Laravel application ships a Vite, and at
 * the time of writing none of them ship Vite 8. Leaving it silently is how an
 * install ends in a build failing on a plugin API that does not exist yet —
 * an error naming neither Vite nor this package. So a major below what the
 * engine needs is reported as an edit to make, and nothing is upgraded on
 * someone's behalf: a Vite major is their decision, and it moves their own
 * asset pipeline too.
 */
function mergeDependencies(o: Options, found: Detected): Step[] {
  const pkg = found.packageJson
  const wanted = JSON.parse(t.packageJson(o)) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }

  const steps: Step[] = []
  const added: string[] = []
  const tooOld: string[] = []

  for (const [field, incoming] of [
    ['dependencies', wanted.dependencies],
    ['devDependencies', wanted.devDependencies],
  ] as const) {
    const current = (pkg[field] as Record<string, string>) ?? {}

    for (const [name, range] of Object.entries(incoming)) {
      // Already declared anywhere: leave it exactly as it is.
      if (found.deps[name]) {
        const have = major(found.deps[name])
        const want = major(range)

        if (have !== null && want !== null && have < want) {
          tooOld.push(`${name} ${found.deps[name]} → ${range}`)
        }

        continue
      }

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

  if (tooOld.length > 0) {
    steps.push({
      kind: 'manual',
      what: 'versions already here that the engine cannot build with',
      detail:
        `left alone — upgrade them yourself, the build fails on the old ones:\n      ` +
        tooOld.join('\n      '),
    })
  }

  return steps
}

/**
 * Laravel's own scripts, exactly as the framework ships them.
 *
 * Matched by value, not by name. `dev` meaning `vite` is a script nobody
 * chose; `dev` meaning anything else is somebody's work and is not ours to
 * reason about.
 */
const STOCK: Record<string, string[]> = {
  dev: ['vite'],
  build: ['vite build'],
}

/**
 * The two pipelines, under one name.
 *
 * `npm run dev` already means the asset pipeline, and after this it has to
 * mean the renderer too — so it means both. Anything else asks a Laravel
 * developer to learn a second command for the thing they already have a
 * command for, and the one they know would silently stop being enough.
 *
 * Sequential for a build because it has to be — the outputs are independent
 * but a failure in either should stop the deploy. Parallel for dev because
 * both are long-lived servers.
 */
function combine(name: string, theirs: string, ours: string): string {
  return name === 'dev'
    ? `concurrently -k -n assets,rsc -c blue,magenta "${theirs}" "${ours}"`
    : `${theirs} && ${ours}`
}

/**
 * Scripts, never over one that somebody wrote.
 *
 * Three outcomes. A name that is free is taken. A name holding the framework's
 * own script is combined, so the command keeps doing what it did and starts
 * doing this as well. A name holding anything else is left completely alone,
 * and the RSC command goes to `rsc:<name>` with the reason reported — a tool
 * that quietly replaces a working build script loses someone's trust
 * permanently, and it only has to be wrong once.
 */
function mergeScripts(o: Options, found: Detected): Step[] {
  const pkg = found.packageJson
  const scripts = (pkg.scripts as Record<string, string>) ?? {}
  const wanted = t.scripts(o)

  const added: string[] = []
  const combined: string[] = []
  const renamed: string[] = []
  let needsConcurrently = false

  for (const [name, command] of Object.entries(wanted)) {
    const existing = scripts[name]

    if (existing === undefined) {
      scripts[name] = command
      added.push(name)
      continue
    }

    if (existing === command) continue

    if (STOCK[name]?.includes(existing.trim())) {
      scripts[name] = combine(name, existing.trim(), command)
      combined.push(name)
      needsConcurrently ||= name === 'dev'
      continue
    }

    const fallback = `rsc:${name}`

    if (scripts[fallback] === undefined) scripts[fallback] = command

    renamed.push(`${name} is yours, so this one is ${fallback}`)
  }

  pkg.scripts = scripts

  const steps: Step[] = []

  if (added.length > 0) steps.push({ kind: 'merged', what: 'scripts', detail: added.join(', ') })

  if (combined.length > 0) {
    steps.push({
      kind: 'merged',
      what: combined.join(' and '),
      detail: 'now runs the asset pipeline AND the renderer',
    })
  }

  // Declared here rather than in the template, because whether it is needed
  // depends on what was already in package.json. Laravel ships it for its own
  // `composer run dev`, so this is usually a no-op.
  if (needsConcurrently && !found.deps.concurrently) {
    const dev = (pkg.devDependencies as Record<string, string>) ?? {}

    dev.concurrently = '^9.0.0'
    pkg.devDependencies = Object.fromEntries(
      Object.entries(dev).sort(([a], [b]) => a.localeCompare(b)),
    )
  }

  if (renamed.length > 0) {
    steps.push({
      kind: 'manual',
      what: 'scripts you wrote yourself',
      detail: `left alone:\n      ${renamed.join('\n      ')}`,
    })
  }

  return steps
}

/** The plugin entry, written if there is no config and printed if there is. */
function viteConfig(o: Options, found: Detected, dir: string): Step[] {
  const file = t.configFile(o)

  // Laravel is asked about a different file than the one it already has. Its
  // vite.config carries laravel-vite-plugin, and the two cannot share a config
  // — so the question is whether the RSC config exists, not whether any does.
  const existing =
    o.host === 'laravel' ? (existsSync(join(dir, file)) ? file : null) : found.viteConfig

  if (existing === null) {
    writeFileSync(join(dir, file), t.viteConfig(o))

    return [{ kind: 'wrote', what: file }]
  }

  const p = t.paths(o)
  const shown = [
    `sourceDir: '${p.sourceDir}'`,
    `outDir: '${p.outDir}'`,
    `assetsDir: '${p.assetsDir}'`,
    ...(p.assetsUrl ? [`assetsUrl: '${p.assetsUrl}'`] : []),
    ...(p.hotFile ? [`hotFile: '${p.hotFile}'`] : []),
  ].join(', ')

  return [
    {
      kind: 'manual',
      what: existing,
      detail:
        `add the plugin — it must come before any react() layer:\n` +
        `      import { rscKit } from '@rsc-kit/core/vite'\n\n` +
        `      plugins: [\n` +
        `        rscKit({ ${shown} }),\n` +
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
            .server(o)
            .split('\n')
            .map((line) => '      ' + line)
            .join('\n'),
      },
    ]
  }

  writeFileSync(join(dir, file), t.server(o))

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

/**
 * A tsconfig, for a project that has none.
 *
 * Laravel ships without one, and the route tree is .tsx — so with nothing here
 * an editor reports an error on every generated file and the `typecheck`
 * script has no configuration to read. Written only when absent, like
 * everything else.
 */
function tsconfig(o: Options, found: Detected, dir: string): Step[] {
  const steps: Step[] = []

  // Written either way. It types the bundle server.ts imports, which does not
  // exist until the first build — and the app's own tsconfig, if it has one,
  // decides for itself whether it looks here.
  if (existsSync(join(dir, t.BUILD_TYPES_FILE))) {
    steps.push({ kind: 'skipped', what: t.BUILD_TYPES_FILE, detail: 'already here' })
  } else {
    writeFileSync(join(dir, t.BUILD_TYPES_FILE), t.buildTypes())
    steps.push({ kind: 'wrote', what: t.BUILD_TYPES_FILE })
  }

  if (found.hasTypeScript) {
    return [...steps, { kind: 'skipped', what: 'tsconfig.json', detail: 'already here' }]
  }

  writeFileSync(join(dir, 'tsconfig.json'), t.tsconfig(o))

  return [...steps, { kind: 'wrote', what: 'tsconfig.json' }]
}

/** Ignore the files the build rewrites into the source dir on every run. */
function gitignore(o: Options, dir: string): Step[] {
  const path = join(dir, '.gitignore')
  const generated = ['rsc-env.d.ts', 'rsc-types.d.ts', 'rsc-routes.d.ts', 'rsc-engine.d.ts'].map(
    (f) => `${o.sourceDir}/${f}`,
  )

  const p = t.paths(o)
  // Everything the build writes. On Laravel that is three separate places —
  // the bundles, the browser assets under public/, and the hot file — and a
  // committed hot file is the worst of them: it points every other machine at
  // a dev server that is not running there.
  const all = [p.outDir, p.assetsDir, ...(p.hotFile ? [p.hotFile] : [])]
  const outputs = all.filter(
    (path) => !all.some((other) => other !== path && path.startsWith(other + '/')),
  )

  const current = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  const missing = [...generated, ...outputs].filter(
    (line) => !current.split('\n').some((existing) => existing.trim() === line),
  )

  if (missing.length === 0) return [{ kind: 'skipped', what: '.gitignore', detail: 'already covers the generated files' }]

  writeFileSync(
    path,
    current + (current.endsWith('\n') || current === '' ? '' : '\n') +
      '\n# The RSC build: rewritten into the source dir every run, and written out.\n' +
      missing.join('\n') + '\n',
  )

  return [{ kind: 'merged', what: '.gitignore', detail: `added ${missing.length} generated paths` }]
}

/** Everything, in the order a reader would want to hear about it. */
export function initialise(o: Options, found: Detected, dir: string): Step[] {
  const steps = [
    ...routes(o, dir),
    ...viteConfig(o, found, dir),
    ...server(o, dir),
    ...tsconfig(o, found, dir),
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
                         laravel is detected from artisan, never asked
    --backend=<url>      for laravel: where host calls go, e.g. http://app.test
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
  const unattended = flags.yes === true || flags.host !== undefined

  stdout.write(`\n${bold('Adding rsc-kit')} ${dim(dir)}\n\n`)
  stdout.write(`  ${dim('server')}      ${found.host}${flags.host ? '' : dim('  (detected)')}\n`)
  stdout.write(`  ${dim('source')}      ${flags.sourceDir ?? found.sourceDir ?? 'src'}\n`)
  stdout.write(`  ${dim('react')}       ${found.hasReact ? 'already here' : 'will be added'}\n`)

  if (found.host === 'laravel') {
    stdout.write(`  ${dim('backend')}     ${flags.backend ?? 'http://localhost'}\n`)
  }

  stdout.write('\n')

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
    core: flags.core ?? publishedCore(),
    backend: flags.backend,
  }

  const steps = initialise(options, found, dir)

  const mark = { wrote: cyan('+'), merged: cyan('~'), manual: bold('!'), skipped: dim('·') }

  stdout.write(`${bold('Done.')}\n\n`)

  for (const step of steps) {
    stdout.write(`  ${mark[step.kind]} ${step.what}${step.detail ? dim('  — ' + step.detail) : ''}\n`)
  }

  const manual = steps.filter((s) => s.kind === 'manual')

  if (manual.length > 0) {
    stdout.write(`\n${bold('Then, by hand:')} the edits marked ! above are in files you already had.\n\n`)

    return
  }

  stdout.write(
    options.host === 'laravel'
      ? `\n  ${cyan('npm install')}, then ${cyan('npm run rsc:dev')} — and open the app at its own domain.\n\n`
      : `\n  ${cyan('bun install')} and you are ready.\n\n`,
  )
}
