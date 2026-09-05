import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// What the generator needs to know, and how it is asked.
//
// Every question has a flag, so the same generator runs unattended: a template
// nobody can script is a template CI cannot check.

export type Host = 'bun' | 'hono' | 'elysia' | 'node'
export type Compiler = 'none' | 'oxc' | 'babel'

export interface Options {
  dir: string
  name: string
  host: Host
  compiler: Compiler
  tailwind: boolean
  lint: boolean
  /** Where the app/ route tree lives, relative to the project. */
  sourceDir: string
  install: boolean
  git: boolean
  /** What to depend on for the engine. A path makes a local checkout testable. */
  core: string
}

export const HOSTS: { value: Host; label: string; hint: string }[] = [
  { value: 'bun', label: 'Bun.serve', hint: 'no framework, fastest to start' },
  { value: 'hono', label: 'Hono', hint: 'also what a Worker or Deno would use' },
  { value: 'elysia', label: 'Elysia', hint: 'Bun-first, typed routes of its own' },
  { value: 'node', label: 'node:http', hint: 'no Bun, no framework' },
]

/**
 * Not asked as a three-way.
 *
 * The compiler has a native implementation and a Babel one, and they produce
 * the same transform — one is just faster to run. Asking which is asking the
 * user to make a build-performance decision on our behalf, in a project whose
 * whole argument is performance. So the prompt is yes/no and the answer is
 * oxc; `--compiler=babel` is there for when the experimental one misbehaves.
 */
export const DEFAULT_COMPILER: Compiler = 'oxc'

/** The published version range, when there is no checkout to prefer. */
export const PUBLISHED_CORE = '^0.1.0'

/**
 * What to depend on for the engine.
 *
 * Run from a checkout — linked, or straight out of the repo — the sibling
 * package is what the author means, and pointing at npm instead fails the
 * install on a version that may not exist yet. Installed from npm there is no
 * sibling and the range is right.
 */
export function defaultCore(fromDir: string): string {
  let dir = fromDir

  for (let up = 0; up < 6; up++) {
    const core = join(dir, 'packages/core/package.json')

    if (existsSync(core)) {
      try {
        const name = JSON.parse(readFileSync(core, 'utf-8')).name

        if (name === '@rsc-kit/core') return 'file:' + join(dir, 'packages/core')
      } catch {
        // Unreadable is the same as absent.
      }
    }

    const parent = dirname(dir)

    if (parent === dir) break

    dir = parent
  }

  return PUBLISHED_CORE
}

export function parseArgs(argv: string[]): Partial<Options> & { help?: boolean; init?: boolean } {
  const out: Partial<Options> & { help?: boolean; init?: boolean } = {}

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--yes' || arg === '-y') out.host ??= 'bun'
    else if (arg === '--no-install') out.install = false
    else if (arg === '--no-git') out.git = false
    else if (arg.startsWith('--source-dir=')) out.sourceDir = arg.slice(13)
    else if (arg === '--init') out.init = true
    else if (arg === '--lint') out.lint = true
    else if (arg === '--no-lint') out.lint = false
    else if (arg === '--tailwind') out.tailwind = true
    else if (arg === '--no-tailwind') out.tailwind = false
    else if (arg.startsWith('--host=')) out.host = arg.slice(7) as Host
    else if (arg.startsWith('--compiler=')) out.compiler = arg.slice(11) as Compiler
    else if (arg.startsWith('--core=')) out.core = arg.slice(7)
    else if (!arg.startsWith('-')) out.dir ??= arg
  }

  return out
}

/**
 * A directory name that is safe to be a package name and to interpolate.
 *
 * The name reaches a TypeScript string literal, JSX text and a package.json
 * field. Escaping it differently at each of those is three chances to get one
 * wrong — an apostrophe alone produced a generated file that would not parse,
 * and a name containing a template expression produced one that executed. So
 * it is checked once, against what npm already allows a package to be called.
 */
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i

export function assertUsableName(name: string): void {
  if (SAFE_NAME.test(name) && name.length <= 214) return

  throw new Error(
    `Not a usable project name: ${JSON.stringify(name)}. ` +
      'Use letters, digits, dots, dashes and underscores — it becomes the package name ' +
      'and is written into generated source.',
  )
}

/**
 * Where the app is written, refusing anywhere that is not below here.
 *
 * A generator that writes outside the directory it was pointed at is a
 * generator nobody can run without reading it first.
 */
export function assertInsideCwd(dir: string, cwd: string): void {
  const inside = dir === cwd || dir.startsWith(cwd.endsWith('/') ? cwd : cwd + '/')

  if (inside) return

  throw new Error(
    `Refusing to write outside the current directory: ${dir}. ` +
      'Change into the directory you want the app in and run it there.',
  )
}

export const HELP = `
  create-rsc-kit — scaffold an RSC app

  Usage
    create-rsc-kit <dir> [options]
    bun create rsc-kit <dir> [options]   (once published)

  Options
    --host=bun|hono|elysia|node   which server to generate
    --compiler=none|oxc|babel     React Compiler (prompt offers oxc; babel by flag)
    --tailwind / --no-tailwind    include Tailwind
    --lint / --no-lint            include oxlint
    --source-dir <dir>            where app/ lives (default: src)
    --init                        add to the project here, rather than scaffold
    --core=<spec>                 engine dependency, e.g. file:../rsc-kit/packages/core
    --no-install                  skip installing dependencies
    --no-git                      skip git init
    -y, --yes                     accept every default, ask nothing
    -h, --help                    this
`
