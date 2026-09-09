#!/usr/bin/env node
// create-rsc-kit — scaffold an app that builds and runs before it is edited.
//
// The point is not saving typing. It is that the combination of choices has
// several things in it that are invisible when wrong: NODE_ENV on the build,
// @source for Tailwind, the ambient declaration for the generated engine
// bundle. Each of those fails by producing a page that looks nearly right.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { argv, exit, stdout } from 'node:process'

import {
  DEFAULT_COMPILER,
  HELP,
  HOSTS,
  publishedCore,
  assertInsideCwd,
  assertUsableName,
  defaultCore,
  parseArgs,
  type Options,
} from './options.js'
import { Prompter, bold, cyan, dim } from './prompt.js'
import * as t from './templates.js'

// Same treatment as a refusal from write(): a bad flag is a decision this tool
// made, and it happens before the try/catch below because the flags are what
// everything else is built from.
/**
 * This package's own version, printed so a stale one is visible.
 *
 * `bun create rsc-kit` is `bunx create-rsc-kit`, and bunx caches its
 * resolution of `latest` under that key — so a machine that ran it once keeps
 * scaffolding from whatever it downloaded then, however many releases ago.
 * There is nothing this package can do about that, but there is something it
 * can do about the symptom, which was a prompt offering hosts that had been
 * removed two releases earlier and no way to tell why.
 *
 * Read rather than baked in: the version is only written at publish time.
 */
function selfVersion(): string {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), '../package.json')

    return `v${(JSON.parse(readFileSync(path, 'utf-8')) as { version: string }).version}`
  } catch {
    return ''
  }
}

const flags = (() => {
  try {
    return parseArgs(argv.slice(2))
  } catch (error) {
    stdout.write(`\n${bold('Cannot scaffold here.')}\n  ${(error as Error).message}\n\n`)
    exit(1)
  }
})()

if (flags.help) {
  stdout.write(HELP)
  exit(0)
}

const unattended = flags.yes === true || flags.host !== undefined

// Resolved once: it walks up from this file looking for the sibling package.
const core = flags.core ?? defaultCore(dirname(fileURLToPath(import.meta.url)))

// Started before the first question and never awaited here — see notifyIfStale.
const staleCheck = checkForNewer()

const options = await collect()

try {
  write(options)
} catch (error) {
  // A refusal is a message, not a crash dump. Everything thrown from write()
  // is a decision this tool made deliberately — an unusable name, a directory
  // outside where it was run — and a stack trace buries the sentence that
  // says which.
  stdout.write(`\n${bold('Cannot scaffold here.')}\n  ${(error as Error).message}\n\n`)
  exit(1)
}

if (options.git) run('git', ['init', '--quiet'], options.dir)

if (options.install) {
  stdout.write(`\n${dim('Installing dependencies…')}\n`)

  const pm = options.host === 'node' ? 'npm' : 'bun'
  const ok = run(pm, ['install'], options.dir)

  if (!ok) {
    stdout.write(
      `\n${bold('Dependencies did not install.')} The files are written; run the install yourself.\n` +
        (options.core === publishedCore()
          ? dim('  @rsc-kit/core may not be published yet — pass --core=file:<path> to use a local checkout.\n')
          : ''),
    )
  }
}

report(options)

await notifyIfStale()

// ── ─────────────────────────────────────────────────────────────────────────

/** Declared, not assigned: collect() runs at module top level, above this. */
function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || 'app'
}

async function collect(): Promise<Options> {
  if (unattended) {
    const dir = flags.dir ?? 'my-app'

    return {
      dir: resolve(dir),
      name: basename(dir),
      host: flags.host ?? 'bun',
      compiler: flags.compiler ?? 'none',
      tailwind: flags.tailwind ?? true,
      lint: flags.lint ?? true,
      sourceDir: flags.sourceDir ?? 'src',
      install: flags.install ?? true,
      git: flags.git ?? true,
      core,
    }
  }

  // Nothing is attached to answer. readline would simply never resolve, and a
  // scaffolder that hangs with no output is indistinguishable from a slow one.
  if (!process.stdin.isTTY) {
    stdout.write(
      `\n${bold('No terminal to ask questions on.')}\n` +
        dim('  Pass the answers as flags instead, e.g.\n') +
        `  ${cyan('create-rsc-kit my-app --host=bun --compiler=none --no-tailwind')}\n` +
        HELP,
    )
    exit(1)
  }

  stdout.write(`\n${bold('Create an RSC app')} ${dim(selfVersion())}\n\n`)

  const p = new Prompter()

  try {
    const dir = flags.dir ?? (await p.text('Directory', 'my-app'))
    const host = await p.select('Where will it run', HOSTS)
    // Yes/no, not which: see DEFAULT_COMPILER.
    const compiler =
      flags.compiler ?? ((await p.confirm('React Compiler', true)) ? DEFAULT_COMPILER : 'none')
    const tailwind = flags.tailwind ?? (await p.confirm('Tailwind CSS', true))
    const lint = flags.lint ?? (await p.confirm('oxlint', true))

    return {
      dir: resolve(dir),
      name: basename(dir),
      host,
      compiler,
      tailwind,
      lint,
      sourceDir: flags.sourceDir ?? 'src',
      install: flags.install ?? (await p.confirm('Install dependencies now', true)),
      git: flags.git ?? true,
      core,
    }
  } finally {
    p.close()
  }
}

function write(o: Options): void {
  // Checked before anything is written: the name is interpolated into
  // generated source, and the directory decides where that source lands.
  assertUsableName(o.name)
  assertInsideCwd(o.dir, process.cwd())

  // An existing directory is fine; an existing *app* is not. Overwriting
  // someone's package.json to scaffold over it is not recoverable.
  if (existsSync(join(o.dir, 'package.json'))) {
    stdout.write(`\n${bold('There is already a package.json in ' + o.dir + '.')}\n`)
    stdout.write(dim('  Choose an empty directory, or delete it first.\n'))
    exit(1)
  }

  if (existsSync(o.dir) && readdirSync(o.dir).some((f) => !f.startsWith('.'))) {
    stdout.write(`\n${dim(o.dir + ' is not empty; adding to it.')}\n`)
  }

  const files: [string, string][] = [
    ['package.json', t.packageJson(o)],
    ['tsconfig.json', t.tsconfig(o)],
    ['vite.config.ts', t.viteConfig(o)],
    ['.gitignore', t.gitignore],
    ['README.md', t.readme(o)],
    ['src/app/layout.tsx', t.layout(o)],
    ['src/app/page.tsx', t.page(o)],
    ['src/components/Counter.tsx', t.counter(o)],
  ]

  if (o.tailwind) files.push(['src/app/styles.css', t.styles])
  if (o.lint) files.push(['.oxlintrc.json', t.oxlintConfig(o)])

  const replaced: string[] = []

  for (const [path, contents] of files) {
    const full = join(o.dir, path)

    // wx: create, or fail. Scaffolding into a directory that already holds a
    // README, a .gitignore or a vite config used to replace them silently —
    // and a .gitignore is exactly the file whose loss is noticed late. The
    // package.json guard above does not cover them, and a directory holding
    // only dotfiles did not even produce the "not empty" notice.
    mkdirSync(dirname(full), { recursive: true })

    try {
      writeFileSync(full, contents, { flag: 'wx' })
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error

      replaced.push(path)
    }
  }

  if (replaced.length > 0) {
    stdout.write(`\n${bold('Left alone, because they already exist:')}\n`)
    for (const path of replaced) stdout.write(`  ${dim(path)}\n`)
  }
}

function run(command: string, args: string[], cwd: string): boolean {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })

  return result.status === 0
}

function report(o: Options): void {
  const pm = o.host === 'node' ? 'npm run' : 'bun run'
  const steps = [
    `cd ${relativeish(o.dir)}`,
    ...(o.install ? [] : [o.host === 'node' ? 'npm install' : 'bun install']),
    // dev first: it is what someone wants next, and it needs no build.
    `${pm} dev`,
    `${pm} build`,
    // A Worker has no start: wrangler runs it on workerd, or deploys it.
    ...(o.host === 'worker' ? [`${pm} preview`, `${pm} deploy`] : [`${pm} start`]),
  ]

  stdout.write(`\n${bold('Done.')} ${dim(o.dir)}\n\n`)
  for (const step of steps) stdout.write(`  ${cyan(step)}\n`)
  stdout.write(
    `\n${dim('Pages live in src/app. Where it deploys is the Nitro preset in vite.config.ts.')}\n\n`,
  )
}

/**
 * Ask the registry what `latest` is, so a stale copy can say so.
 *
 * Printing the version alone does not help: nobody knows 0.5.0 is two behind
 * unless something tells them.
 *
 * `bun create rsc-kit` is `bunx create-rsc-kit`, and bunx reuses what it
 * downloaded the first time — a machine that ran this once keeps scaffolding
 * from that copy however many releases later. Writing the tag out is what
 * makes it revalidate. Measured against a 0.6.0 planted in the cache:
 *
 *   bun create rsc-kit             stale
 *   bunx create-rsc-kit            stale
 *   bun create rsc-kit@latest      fresh
 *   bunx create-rsc-kit@latest     fresh
 *   npx create-rsc-kit@latest      fresh
 *
 * So the escape is one word, and this is what tells someone to use it — the
 * form without it is the one every set of install instructions writes.
 *
 * create-next-app does this with the `update-check` package. Not here: this
 * package is installed by bunx before it can ask anything, so a dependency is
 * latency every user waits through — the same reason the prompts are written
 * against readline. It is one request.
 *
 * Started before the first prompt and read after the last, so it costs nothing
 * — a person answering questions is slower than a registry. Failure is
 * silence: offline, behind a proxy, or a registry that is down are all just no
 * notice rather than a scaffolder that will not run.
 */
function checkForNewer(): Promise<string | null> {
  // Unknown is not stale. selfVersion() answers '' when it cannot read the
  // manifest, and comparing against that would report every run as behind.
  const mine = selfVersion().slice(1)

  if (!mine) return Promise.resolve(null)

  return (async () => {
    const response = await fetch('https://registry.npmjs.org/create-rsc-kit/latest', {
      signal: AbortSignal.timeout(3000),
      headers: { accept: 'application/json' },
    })

    if (!response.ok) return null

    const latest = (await response.json()).version as string

    return latest && latest !== mine ? latest : null
  })().catch(() => null)
}

async function notifyIfStale(): Promise<void> {
  const latest = await staleCheck

  if (!latest) return

  stdout.write(
    `${dim('A newer create-rsc-kit is out:')} ${bold(`v${latest}`)}${dim(`, and this is ${selfVersion()}.`)}\n` +
      `${dim('bunx reuses the copy it downloaded first. Name the tag and it fetches:')}\n\n` +
      `  ${cyan('bun create rsc-kit@latest')}\n\n`,
  )
}

/** A path the user can paste, when it is under where they are. */
function relativeish(dir: string): string {
  const cwd = process.cwd()

  return dir.startsWith(cwd + '/') ? dir.slice(cwd.length + 1) : dir
}
