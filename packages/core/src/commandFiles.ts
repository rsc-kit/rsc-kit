/**
 * The build's half of app commands: which files in `src/commands` are
 * commands, what the generated entry says about them, and the small entries
 * that run one. The runner they call is `commands.ts`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CommandFile {
  /** What is typed after the binary: the file's name without its extension. */
  name: string
  /** Absolute path, imported lazily by the entry. */
  file: string
  /** A plain string literal exported as `description`, for `--help`. */
  description?: string
}

export interface CommandFiles {
  commands: CommandFile[]
  /** Paths under src/commands that are not commands, and why, for the build to say. */
  ignored: { path: string; reason: string }[]
}

const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/

/** Earlier wins when two files share a name: migrate.ts over migrate.js. */
const EXTENSION_ORDER = ['ts', 'mts', 'cts', 'tsx', 'js', 'mjs', 'cjs', 'jsx']

/**
 * `export const description = 'Apply the database migrations'`, read off the
 * source so `--help` can list a command without loading it - a command's
 * imports are the database and the logger, and listing should not open either.
 * A plain string literal only; anything computed is simply not listed.
 */
function describe(source: string): string | undefined {
  const match = /^\s*export\s+const\s+description\s*(?::\s*string\s*)?=\s*(["'`])([^"'`\\\n$]*)\1/m.exec(source)

  return match?.[2]?.trim() || undefined
}

/**
 * The commands under `<sourceDir>/commands`.
 *
 * Flat on purpose: a name is what a person types, and `db/seed.ts` raises
 * whether that is `db:seed`, `db/seed` or `seed`. Declaration files, tests and
 * anything starting with `_` or `.` are not commands - the last is how a
 * helper lives beside the commands that share it.
 */
export function commandFiles(sourceDir: string): CommandFiles {
  const dir = join(sourceDir, 'commands')
  const found: CommandFiles = { commands: [], ignored: [] }

  if (!existsSync(dir)) return found

  const taken = new Map<string, CommandFile>()
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const path = join(dir, entry.name)

    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue

    if (entry.isDirectory()) {
      found.ignored.push({ path, reason: 'commands are the files directly in src/commands, not a folder of them' })

      continue
    }

    if (!SOURCE.test(entry.name) || /\.d\.[cm]?ts$/.test(entry.name) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue

    const extension = entry.name.slice(entry.name.lastIndexOf('.') + 1)
    const name = entry.name.slice(0, -(extension.length + 1))

    if (!NAME.test(name)) {
      found.ignored.push({ path, reason: `"${name}" cannot be typed as a command: letters, digits, "-", "_", "." and ":"` })

      continue
    }

    const existing = taken.get(name)

    if (existing) {
      const keep = EXTENSION_ORDER.indexOf(existing.file.split('.').pop() ?? '') <= EXTENSION_ORDER.indexOf(extension)

      found.ignored.push({
        path: keep ? path : existing.file,
        reason: `two files are called "${name}"; ${keep ? existing.file : path} is the command`,
      })

      if (keep) continue

      found.commands.splice(found.commands.indexOf(existing), 1)
    }

    const command: CommandFile = { name, file: path, description: describe(readFileSync(path, 'utf-8')) }

    taken.set(name, command)
    found.commands.push(command)
  }

  return found
}

/** The module the generated entry reads the table from, resolved when the bundle is built. */
export const COMMANDS_MODULE_ID = 'virtual:rsc-kit/commands'

/**
 * The table: every command as a dynamic import, so each is a chunk of its own
 * and the server never evaluates one. An empty object when there are none -
 * a Worker's build, say, which does not carry them.
 *
 * A module of its own rather than text in the entry because the entry is
 * written while the config is still being read, before anything knows the
 * build's mode or which Nitro preset it is for.
 */
export function commandsModule(commands: readonly CommandFile[]): string {
  const rows = commands.map(
    ({ name, file, description }) =>
      `  ${JSON.stringify(name)}: { load: () => import(${JSON.stringify(file)})${description ? `, description: ${JSON.stringify(description)}` : ''} },`,
  )

  return `export const commands = {\n${rows.join('\n')}\n}\n`
}

/**
 * What the generated server entry adds for an app with a `src/commands`:
 * `runCommand` over the table, with the entry's own `register()` and
 * `shutdown()`. `runner` is the engine's `commands` module, named without an
 * extension like every other engine module the entry imports.
 */
export function commandsEntry(runner: string): string {
  return `
import { commands as __commands } from ${JSON.stringify(COMMANDS_MODULE_ID)}
import { runCommand as __runCommand } from ${JSON.stringify(runner)}

// src/commands, each loaded only when it is named.
export function runCommand(argv: string[], program?: string) {
  return __runCommand(argv, { commands: __commands, program, ready: instrumented, shutdown: __instrumentation.shutdown })
}
`
}

/**
 * The entry a plain build runs a command from, written beside the server:
 *
 *     node .output/server/commands.mjs migrate
 *     bun .output/server/commands.mjs migrate
 *
 * The server is not started - nothing here imports it - and the flag is set
 * before the entry is imported, since importing it is what would otherwise
 * call register().
 */
export function commandsEntrySource(): string {
  return (
    '// Run one of the app\'s commands without starting the server:\n' +
    '//   node .output/server/commands.mjs <command> [args]\n' +
    '//   bun .output/server/commands.mjs <command> [args]\n' +
    'import { relative } from "node:path";\n' +
    'import { fileURLToPath } from "node:url";\n' +
    '\n' +
    'globalThis[Symbol.for("rsc-kit.command")] = true;\n' +
    '\n' +
    'let code = 1;\n' +
    '\n' +
    'try {\n' +
    '  const { runCommand } = await import("./_ssr/rsc.mjs");\n' +
    '  const runtime = process.versions.bun ? "bun" : "node";\n' +
    '\n' +
    '  code = await runCommand(process.argv.slice(2), runtime + " " + relative(process.cwd(), fileURLToPath(import.meta.url)));\n' +
    '} catch (error) {\n' +
    '  // The app failed to load: instrumentation.ts refusing a bad environment,\n' +
    '  // as it would stop the server.\n' +
    '  console.error("[rsc-kit] the app failed to load:", error);\n' +
    '}\n' +
    '\n' +
    'process.exit(code);\n'
  )
}
