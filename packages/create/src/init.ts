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

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
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
  /** A Go module: the backend is Go, and answers host calls from its own server. */
  go: boolean
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

// Nothing here detects a host any more: a host is a Nitro preset, and Nitro
// is added to whatever project this runs in.
const HOST_PACKAGES: Record<string, Host> = {}

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
    go: existsSync(join(dir, 'go.mod')),
    host,
    // resources/js, the directory a Laravel app already keeps its JavaScript
    // in, so the route tree is resources/js/app the way it is src/app
    // everywhere else. The stock app.js and bootstrap.js beside it are files,
    // not the app/ directory, and the route tree never looks at them. An app
    // that init set up before this default - a tree at resources/js/rsc/app
    // - keeps it: a second run must never move a tree.
    sourceDir: laravel
      ? existsSync(join(dir, 'resources/js/rsc/app'))
        ? 'resources/js/rsc'
        : 'resources/js'
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
  // laravel-vite-plugin served the Blade asset pipeline, which the renderer
  // replaces; left installed it would still be resolvable from the moved-aside
  // config, and nothing else. Removed from the manifest so `npm install` does
  // not keep fetching it; the moved-aside config names it in its own steps.
  if (o.host === 'laravel') {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const bucket = found.packageJson[field] as Record<string, string> | undefined

      if (bucket && 'laravel-vite-plugin' in bucket) delete bucket['laravel-vite-plugin']
    }
  }

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
/** Where this tool's section of an AGENTS.md begins and ends, so a second run finds it. */
const AGENTS_START = '<!-- rsc-kit:start -->'
const AGENTS_END = '<!-- rsc-kit:end -->'

/**
 * This tool's instructions, added to an existing AGENTS.md or written as one.
 *
 * Someone else's instructions are not a file to rewrite, but a delimited
 * section at the end is not a rewrite: theirs stay exactly as written above
 * it, the markers say what is ours, and a second run finds the markers and
 * leaves it be. A project that already has an AGENTS.md is the project whose
 * agents most need to hear how this works.
 */
function mergeAgents(dir: string, o: Options): Step {
  const path = join(dir, 'AGENTS.md')

  if (!existsSync(path)) {
    writeFileSync(path, t.agents(o))

    return { kind: 'wrote', what: 'AGENTS.md' }
  }

  const existing = readFileSync(path, 'utf8')

  if (existing.includes(AGENTS_START) || /rsc-kit/i.test(existing)) {
    return { kind: 'skipped', what: 'AGENTS.md', detail: 'already covers rsc-kit' }
  }

  writeFileSync(
    path,
    existing.replace(/\s*$/, '\n\n') + `${AGENTS_START}\n${t.agents(o).trim()}\n${AGENTS_END}\n`,
  )

  return { kind: 'merged', what: 'AGENTS.md', detail: 'added a section at the end; yours is untouched above it' }
}

/**
 * The rsc-kit server, added to an existing .mcp.json or written as a new one.
 *
 * The file is a map of servers under `mcpServers`; a project with other
 * servers keeps them, and one that already lists rsc-kit is left alone. A
 * file that does not parse is not one to rewrite.
 */
function mergeMcp(dir: string, o: Options): Step {
  const path = join(dir, '.mcp.json')

  if (!existsSync(path)) {
    writeFileSync(path, t.mcp(o))

    return { kind: 'wrote', what: '.mcp.json' }
  }

  let existing: { mcpServers?: Record<string, unknown> }

  try {
    existing = JSON.parse(readFileSync(path, 'utf8')) as typeof existing
  } catch {
    return { kind: 'skipped', what: '.mcp.json', detail: 'already exists and is not JSON; add the rsc-kit server by hand' }
  }

  if (existing.mcpServers?.['rsc-kit']) {
    return { kind: 'skipped', what: '.mcp.json', detail: 'already lists rsc-kit' }
  }

  const ours = (JSON.parse(t.mcp(o)) as { mcpServers: Record<string, unknown> }).mcpServers['rsc-kit']

  existing.mcpServers = { ...(existing.mcpServers ?? {}), 'rsc-kit': ours }
  writeFileSync(path, JSON.stringify(existing, null, 2) + '\n')

  return { kind: 'merged', what: '.mcp.json', detail: 'added the rsc-kit server beside the others' }
}

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
      // A stock script. On Laravel it was the Blade asset pipeline's, and
      // the renderer owns the frontend now - one config, one pipeline - so
      // it is replaced rather than run beside. Elsewhere the two are
      // combined, so the command keeps doing what it did as well.
      if (o.host === 'laravel') {
        scripts[name] = command
        combined.push(name)
        continue
      }

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
      detail:
        o.host === 'laravel'
          ? 'the renderer, in place of the Blade pipeline they ran'
          : 'now runs the asset pipeline AND the renderer',
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
  const existing = found.viteConfig

  if (existing === null) {
    writeFileSync(join(dir, file), t.viteConfig(o))

    return [{ kind: 'wrote', what: file }]
  }

  // A Laravel app's vite.config carries laravel-vite-plugin, which owns
  // base, publicDir, outDir, the input list and the server origin - the same
  // things this build owns - so the two cannot share a file. They do not
  // need to: once the renderer owns the frontend there is no @vite
  // directive and no Blade asset pipeline for that plugin to serve. The old
  // config is kept beside the new one, for a Blade page or two that still
  // needs it, rather than lost.
  if (o.host === 'laravel') {
    const source = readFileSync(join(dir, existing), 'utf-8')

    // Already the renderer's: a second run, or a hand-written one.
    if (source.includes('rscKit(')) {
      return [{ kind: 'skipped', what: existing, detail: 'already has rscKit()' }]
    }

    // Some other config the build cannot own - not Blade's - so the edit is
    // printed rather than the file replaced.
    if (!source.includes('laravel-vite-plugin')) {
      return [manualPluginStep(o, existing)]
    }

    const aside = existing.replace(/vite\.config/, 'vite.config.blade')

    if (!existsSync(join(dir, aside))) renameSync(join(dir, existing), join(dir, aside))
    writeFileSync(join(dir, file), t.viteConfig(o))

    return [
      { kind: 'wrote', what: file, detail: `the renderer owns the frontend now` },
      {
        kind: 'manual',
        what: aside,
        detail:
          `your previous config, moved aside. It served the Blade asset pipeline ` +
          `(laravel-vite-plugin, @vite in a layout). Delete it once nothing uses that; ` +
          `to keep a Blade page, build it with \`vite build --config ${aside}\`.`,
      },
    ]
  }

  return [manualPluginStep(o, existing)]
}

/** The edit to make by hand when a config the build cannot own is already there. */
function manualPluginStep(o: Options, existing: string): Step {
  const p = t.paths(o)
  const shown = [
    `sourceDir: '${p.sourceDir}'`,
    `outDir: '${p.outDir}'`,
    ...(p.hotFile ? [`hotFile: '${p.hotFile}'`] : []),
  ].join(', ')

  return {
    kind: 'manual',
    what: existing,
    detail:
      `add the plugin — it must come before any react() layer:\n` +
      `      import { rscKit } from '@rsc-kit/core/vite'\n\n` +
      `      plugins: [\n` +
      `        rscKit({ ${shown} }),\n` +
      `        …whatever you already have\n` +
      `      ]`,
  }
}

/** The route tree, only where there is not one already. */
function routes(o: Options, dir: string): Step[] {
  const appDir = join(dir, o.sourceDir, 'app')
  const steps: Step[] = []

  // The two files beside the tree are looked at whether or not the tree is
  // here: a project that already has pages is the one whose agents and
  // editor most need to know about this.
  steps.push(mergeAgents(dir, o), mergeMcp(dir, o))

  if (existsSync(join(appDir, 'layout.tsx')) || existsSync(join(appDir, 'page.tsx'))) {
    return [...steps, { kind: 'skipped', what: `${o.sourceDir}/app`, detail: 'a route tree is already here' }]
  }

  const files: [string, string][] = [
    [join(o.sourceDir, 'app/layout.tsx'), t.layout(o)],
    [join(o.sourceDir, 'app/page.tsx'), t.page(o)],
    [join(o.sourceDir, 'components/Counter.tsx'), t.counter(o)],
  ]

  if (o.tailwind) files.push([join(o.sourceDir, 'app/styles.css'), t.styles])
  if (o.host !== 'laravel') files.push(['tests/app.test.ts', t.smokeTest(o)])

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
 * A tsconfig, for a project that has none — and one line for a project that has.
 *
 * Laravel ships without one, and the route tree is .tsx — so with nothing here
 * an editor reports an error on every generated file and the `typecheck`
 * script has no configuration to read. Written only when absent, like
 * everything else.
 *
 * Where one exists it is not replaced, but `include` still has to name
 * `.rsc-kit`, because that is where the build writes its ambient declarations
 * and TypeScript will not find them otherwise. Not a style preference: a
 * directory whose name begins with a dot is outside the default `**\/*`, so a
 * project with no `include` at all misses them exactly like one that lists
 * only `src`. Measured both ways.
 *
 * Missing it is invisible — every file is written, the build passes, and Link
 * takes `string` again instead of the route union, so a link to a page that
 * does not exist compiles and 404s in the browser.
 */
/** JSON with comments, made JSON: comments outside strings removed, strings kept whole. */
function withoutComments(source: string): string {
  let out = ''
  let i = 0

  while (i < source.length) {
    const c = source[i]

    if (c === '"') {
      const end = source.indexOf('"', i + 1)
      let j = end

      // A quote escaped inside the string is not its end.
      while (j !== -1 && source[j - 1] === '\\') j = source.indexOf('"', j + 1)

      const close = j === -1 ? source.length : j + 1

      out += source.slice(i, close)
      i = close
      continue
    }

    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i)

      i = nl === -1 ? source.length : nl
      continue
    }

    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)

      i = end === -1 ? source.length : end + 2
      continue
    }

    out += c
    i++
  }

  return out
}

function tsconfig(o: Options, found: Detected, dir: string): Step[] {
  const path = join(dir, 'tsconfig.json')

  if (!found.hasTypeScript) {
    writeFileSync(path, t.tsconfig(o))

    return [{ kind: 'wrote', what: 'tsconfig.json' }]
  }

  // Edited in place, never reprinted: parsing and printing the file would
  // lose the comments a tsconfig is allowed to have and the formatting
  // someone chose. The entry goes in as text, at the front of the include
  // list that is there, or as a list of its own after the opening brace.
  const current = readFileSync(path, 'utf-8')

  // Comments are legal here and JSON.parse does not take them. Stripped
  // outside strings only: a glob like ".rsc-kit/**/*" holds "/*", and a
  // regex that did not know about strings read it as a comment opening,
  // ate the rest of the file, and reported the tsconfig this very tool
  // wrote as missing the entry it wrote.
  const include = (() => {
    try {
      const parsed = JSON.parse(withoutComments(current)) as { include?: unknown }

      return Array.isArray(parsed.include) ? (parsed.include as unknown[]) : null
    } catch {
      return null
    }
  })()

  if (include?.some((entry) => typeof entry === 'string' && entry.includes('.rsc-kit'))) {
    return [{ kind: 'skipped', what: 'tsconfig.json', detail: 'already includes .rsc-kit' }]
  }

  // An absent `include` is not an empty one — TypeScript's default covers the
  // project — but the default is `**\/*`, and a directory whose name begins
  // with a dot is outside it. So both cases need the entry, and a project with
  // no `include` needs `**\/*` written alongside it or it loses everything
  // else. Measured both ways.
  const opened = /"include"\s*:\s*\[/.exec(current)

  if (include && opened) {
    const at = opened.index + opened[0].length
    const rest = current.slice(at)
    // The list's own style: one entry per line, or all on one.
    const separator = /^\s*\n/.test(rest) ? rest.match(/^\s*\n(\s*)/)![0] : ' '

    writeFileSync(path, current.slice(0, at) + `${separator}"${TYPES_GLOB}",` + (separator === ' ' ? ' ' : '') + rest.replace(/^\s*\n/, ''))

    return [{ kind: 'merged', what: 'tsconfig.json', detail: `added "${TYPES_GLOB}" to "include"` }]
  }

  const brace = current.indexOf('{')

  if (!include && brace !== -1) {
    writeFileSync(
      path,
      current.slice(0, brace + 1) + `\n  "include": ["**/*", "${TYPES_GLOB}"],` + current.slice(brace + 1),
    )

    return [{ kind: 'merged', what: 'tsconfig.json', detail: `added "include": ["**/*", "${TYPES_GLOB}"]` }]
  }

  return [
    {
      kind: 'manual',
      what: 'tsconfig.json',
      detail: `add "${TYPES_GLOB}" to "include", or typed routes fall back to string`,
    },
  ]
}

/** Where the build writes its ambient declarations, as a tsconfig include. */
const TYPES_GLOB = '.rsc-kit/**/*'

/** Ignore the files the build rewrites into the source dir on every run. */
function gitignore(o: Options, dir: string): Step[] {
  const path = join(dir, '.gitignore')
  // The declarations moved out of the source directory into .rsc-kit, so this
  // is one line where it used to be four. The stub stays put — the app imports
  // it by relative path.
  const generated = ['.rsc-kit/', `${o.sourceDir}/server-actions.generated.ts`]

  const p = t.paths(o)
  // Everything the build writes: the bundles, Nitro's output, and the hot
  // file. The hot file is the worst of them to commit — it points every other
  // machine at a dev server that is not running there.
  const all = ['.output', p.outDir, ...(p.hotFile ? [p.hotFile] : [])]
  const outputs = all.filter(
    (path) => !all.some((other) => other !== path && path.startsWith(other + '/')),
  )

  // A backend's secret lives in .env, which is the file whose commit is
  // noticed late. Only when there is one: a project without a backend has
  // its own policy and this leaves it alone.
  const secrets = o.backend && o.host !== 'laravel' ? ['.env', '.env.*', '!.env.example'] : []

  const current = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  const missing = [...generated, ...outputs, ...secrets].filter(
    (line) => !current.split('\n').some((existing) => existing.trim() === line),
  )

  if (missing.length === 0) return [{ kind: 'skipped', what: '.gitignore', detail: 'already covers the generated files' }]

  // The blank line separates this block from whatever was above it, so there
  // is nothing to separate from when the file is new.
  const head = current === '' ? '' : current.endsWith('\n') ? current + '\n' : current + '\n\n'

  writeFileSync(
    path,
    head + '# The RSC build: rewritten every run, and what it builds.\n' + missing.join('\n') + '\n',
  )

  return [{ kind: 'merged', what: '.gitignore', detail: `added ${missing.length} generated paths` }]
}

/** Everything, in the order a reader would want to hear about it. */
/**
 * The backend's two lines, for a project that has one and is not Laravel.
 *
 * .env is written once and never rewritten: the secret in it is the one the
 * backend was given, and regenerating it on a second run would answer every
 * host call with 403 - which reads as the application refusing its own data.
 * The wiring on the other side is printed, never written: a package main in
 * someone's module is not a file to add blind.
 */
function backend(o: Options, found: Detected, dir: string): Step[] {
  if (!o.backend || o.host === 'laravel') return []

  const steps: Step[] = []
  const env = join(dir, '.env')

  if (existsSync(env)) {
    // The two lines, added to what is there. A secret already present is
    // the one the backend was given and is never regenerated; a backend
    // already named is left as named.
    const current = readFileSync(env, 'utf8')
    const missing: string[] = []

    if (!/^\s*RSC_BACKEND=/m.test(current)) missing.push(`RSC_BACKEND=${o.backend}`)
    if (!/^\s*RSC_HOST_CALL_SECRET=/m.test(current)) {
      missing.push(`RSC_HOST_CALL_SECRET=${randomBytes(32).toString('base64url')}`)
    }

    if (missing.length === 0) {
      steps.push({ kind: 'skipped', what: '.env', detail: 'already has RSC_BACKEND and RSC_HOST_CALL_SECRET' })
    } else {
      writeFileSync(env, current.replace(/\s*$/, '\n\n') + missing.join('\n') + '\n')
      steps.push({ kind: 'merged', what: '.env', detail: `added ${missing.map((line) => line.split('=')[0]).join(' and ')}` })
    }
  } else {
    writeFileSync(env, t.backendEnv(o.backend, randomBytes(32).toString('base64url')))
    steps.push({ kind: 'wrote', what: '.env', detail: 'RSC_BACKEND and a generated RSC_HOST_CALL_SECRET' })
  }

  const example = join(dir, '.env.example')

  if (!existsSync(example)) {
    writeFileSync(example, t.backendEnvExample(o.backend))
    steps.push({ kind: 'wrote', what: '.env.example' })
  }

  steps.push({ kind: 'manual', what: 'backend', detail: t.backendStep(found.go) })

  return steps
}

export function initialise(o: Options, found: Detected, dir: string): Step[] {
  const steps = [
    ...routes(o, dir),
    ...viteConfig(o, found, dir),
    ...tsconfig(o, found, dir),
    ...gitignore(o, dir),
    ...backend(o, found, dir),
    ...mergeDependencies(o, found),
    ...mergeScripts(o, found),
  ]

  writeFileSync(join(dir, 'package.json'), JSON.stringify(found.packageJson, null, 2) + '\n')

  return steps
}


/** Where a Go server listens, unless told otherwise. */
const DEFAULT_BACKEND = 'http://127.0.0.1:8080'

const INIT_HELP = `
  rsc-kit init — add RSC to the project in this directory

  Nothing existing is rewritten. New files are written; a file that is a list
  gets our entry added to it - .mcp.json, AGENTS.md, tsconfig.json's include,
  .env - with yours left as written; and for anything else already there the
  exact edit is printed for you to make.

  Options
    --source-dir <dir>   where app/ should live (detected, usually src)
    --host=…             bun | hono | elysia | node (detected from your deps)
                         laravel is detected from artisan, never asked
    --backend=<url>      a backend answering host calls - a Go server, say, at
                         http://127.0.0.1:8080 (assumed when go.mod is here);
                         laravel reads APP_URL instead
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
        `  ${cyan('bun create rsc-kit@latest my-app')}\n\n`,
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

  const backendUrl = flags.backend ?? (found.go ? DEFAULT_BACKEND : undefined)

  if (found.host === 'laravel') {
    stdout.write(`  ${dim('backend')}     ${flags.backend ?? 'http://localhost'}\n`)
  } else if (backendUrl) {
    stdout.write(`  ${dim('backend')}     ${backendUrl}${flags.backend ? '' : dim('  (go.mod is here)')}\n`)
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
    // An existing project has its own schema library and env handling; init adds neither.
    validation: 'none' as const,
    env: false,
    // Adding to a project writes no service worker; that is a decision for
    // the app, and create --pwa is where it is offered.
    pwa: false,
    sourceDir: flags.sourceDir ?? found.sourceDir ?? 'src',
    install: false,
    git: false,
    core: flags.core ?? publishedCore(),
    backend: backendUrl,
  }

  const steps = initialise(options, found, dir)

  const mark = { wrote: cyan('+'), merged: cyan('~'), manual: bold('!'), skipped: dim('·') }

  stdout.write(`${bold('Done.')}\n\n`)

  for (const step of steps) {
    stdout.write(`  ${mark[step.kind]} ${step.what}${step.detail ? dim('  — ' + step.detail) : ''}\n`)
  }

  const manual = steps.filter((s) => s.kind === 'manual')

  if (manual.length > 0) {
    stdout.write(`\n${bold('Then, by hand:')} the steps marked ! above.\n\n`)

    return
  }

  stdout.write(
    options.host === 'laravel'
      ? `\n  ${cyan('npm install')}, then ${cyan('npm run dev')} — and open the app at its own domain.\n\n`
      : `\n  ${cyan('bun install')} and you are ready.\n\n`,
  )
}
