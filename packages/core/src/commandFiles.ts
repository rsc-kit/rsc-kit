/**
 * The build's half of app commands: which files in `src/commands` are
 * commands, what the generated entry says about them, and the small entries
 * that run one. The runner they call is `commands.ts`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { commandHelp, EARLY_SIGNALS } from './commands.js'
import { inlineModuleName } from './files.js'

export interface CommandFile {
  /** What is typed after the binary: the file's name without its extension. */
  name: string
  /** Absolute path, imported lazily by the entry. */
  file: string
  /** A plain string literal exported as `description`, for `--help`. */
  description?: string
  /**
   * `export const register = true`: runs from the server's bundle, which
   * imports instrumentation.ts. Every other command runs from one that does
   * not - see BARE_COMMANDS_MODULE_ID.
   */
  instrumented?: boolean
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
 * `export const register = true`, read off the source as `description` is:
 * which bundle a command runs from is decided before anything loads, and only
 * one that asked for register() has a reason to load instrumentation.ts.
 */
function registers(source: string): boolean {
  return /^\s*export\s+const\s+register\s*(?::\s*boolean\s*)?=\s*true\b/m.test(source)
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

    const source = readFileSync(path, 'utf-8')
    const command: CommandFile = { name, file: path, description: describe(source) }

    if (registers(source)) command.instrumented = true

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
 * The commands that did not ask for register(), as a bundle of their own.
 *
 * The server's entry imports instrumentation.ts first and statically - that is
 * what stops a server with a bad environment before it serves - so anything
 * loaded through it has validated the web's whole schema. A queue drain that
 * imports only the worker's still needed the web's Stripe and session
 * secrets. This module is the entry of a server environment of its own,
 * bundled apart from the server's, so nothing in it can import back into the
 * entry that loads instrumentation.ts. Each command's own imports still run:
 * it validates what it imports, which is the point.
 */
export const BARE_COMMANDS_MODULE_ID = 'virtual:rsc-kit/commands-bare'

/**
 * Its name as an input of the rsc environment, and so the file the server
 * runs it from: `_ssr/rsc-commands.mjs`, beside the server's `_ssr/rsc.mjs`.
 */
export const BARE_COMMANDS_ENVIRONMENT = 'rsc-commands'

/** The bare table's module: runCommand over it, with no register() to give. */
export function bareCommandsModule(commands: readonly CommandFile[], runner: string): string {
  return (
    `import { runCommand as __runCommand } from ${JSON.stringify(runner)}\n` +
    commandsModule(commands.filter((command) => !command.instrumented)) +
    // Reached only by a register that is true at runtime but not as a literal
    // the build could read, which put the command in the wrong bundle.
    'const noRegister = () => Promise.reject(new Error("register() runs for a command that says export const register = true, as a literal: this one computes it, so it was built without instrumentation.ts."))\n' +
    'export function runCommand(argv, program) {\n' +
    '  return __runCommand(argv, { commands, program, ready: noRegister })\n' +
    '}\n'
  )
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

/** What the entries need to know that only the build does. */
export interface CommandEntryOptions {
  commands: readonly CommandFile[]
  /** Polyfills the app's graph has (`reflect-metadata`), by package name. */
  polyfills: readonly string[]
}

/**
 * What the entries can answer without loading the app: `--help`, no command,
 * a name that is not one.
 *
 * Loading the app imports instrumentation.ts, and so validates the
 * environment - and `./app --help` on a build machine, or in a CI step that
 * has no database url, is not a reason to refuse. The names and descriptions
 * are in the entry itself because the binary carries nothing else: a
 * Dockerfile copies `dist/app` and `.output/rsc-kit.json` is not in it.
 *
 * The help text is written by the same function the runner uses, with the
 * program's name left to fill in, so the two cannot word it differently.
 * `answer` is the whole of the logic; the runner repeats it as a backstop.
 */
export function commandAnswerSource({ commands }: CommandEntryOptions): string {
  const table = Object.fromEntries(commands.map(({ name, description }) => [name, { description }]))
  const help = commandHelp(table, '%PROGRAM%')

  return (
    `const COMMAND_NAMES = ${JSON.stringify(commands.map((c) => c.name))};\n` +
    // Run from their own bundle, which does not import instrumentation.ts.
    `const BARE_COMMANDS = ${JSON.stringify(commands.filter((c) => !c.instrumented).map((c) => c.name))};\n` +
    `const COMMAND_HELP = ${JSON.stringify(help)};\n` +
    '\n' +
    'const answer = (argv, program) => {\n' +
    '  const [name] = argv;\n' +
    '  const help = COMMAND_HELP.split("%PROGRAM%").join(program);\n' +
    '\n' +
    '  if (name === "--help" || name === "-h") return { code: 0, text: help };\n' +
    '  if (name === undefined) return { code: 2, text: help };\n' +
    '  if (!COMMAND_NAMES.includes(name)) return { code: 2, text: "Not a command: " + name + "\\n\\n" + help };\n' +
    '\n' +
    '  return null;\n' +
    '};\n'
  )
}

/**
 * The process's SIGTERM and SIGINT, held from before the app loads.
 *
 * The runner takes over once the app has loaded, and the app can take a while
 * - a signal before that finds only the default action, which ends the
 * process with 143 and neither stops a worker the way it asks nor lets it
 * say it stopped. These listeners count what comes first and the runner is
 * handed it (see EARLY_SIGNALS in commands.ts), and from then on each signal
 * is passed to the runner. They are never taken off: a signal is delivered on
 * the event loop's next turn, and one that arrived during a synchronous load
 * is lost to a listener removed before that turn.
 *
 * If the load never finishes the process still ends: RSC_SHUTDOWN_TIMEOUT
 * after the first, or at once on the second.
 */
function earlySignalsSource(): string {
  return (
    'const early = { count: 0, timer: undefined, listener: undefined };\n' +
    'const onSignal = () => {\n' +
    '  if (early.listener) return early.listener();\n' +
    '\n' +
    '  early.count += 1;\n' +
    '\n' +
    '  if (early.count > 1) process.exit(1);\n' +
    '\n' +
    '  early.timer = setTimeout(() => process.exit(1), (Number(process.env.RSC_SHUTDOWN_TIMEOUT) || 10) * 1000);\n' +
    '};\n' +
    'early.handoff = (listener) => {\n' +
    '  clearTimeout(early.timer);\n' +
    '  early.listener = listener;\n' +
    '};\n' +
    'process.on("SIGTERM", onSignal);\n' +
    'process.on("SIGINT", onSignal);\n' +
    `globalThis[Symbol.for(${JSON.stringify(EARLY_SIGNALS.description)})] = early;\n`
  )
}

/**
 * Loading the app to run a command: the polyfills first, then the entry.
 *
 * A polyfill a dependency checks for at import (`reflect-metadata`, which
 * tsyringe wants and an auth library brings) is loaded for the server by a
 * Nitro plugin, and a command does not go through Nitro. The bundler decides
 * where an external import lands among the chunks, so the app cannot be left
 * to import it in time - this does, by name, from the copy the build traced
 * beside the server. Only in the command path: the server has its own.
 */
function loadAppSource(polyfills: readonly string[]): string {
  const loads = polyfills.map((name) => `await import(${JSON.stringify(name)});\n`).join('')

  return (
    loads +
    'const { runCommand } = await (BARE_COMMANDS.includes(argv[0]) ? import("./_ssr/' + BARE_COMMANDS_ENVIRONMENT + '.mjs") : import("./_ssr/rsc.mjs"));\n'
  )
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
export function commandsEntrySource(options: CommandEntryOptions): string {
  return (
    "// Run one of the app's commands without starting the server:\n" +
    '//   node .output/server/commands.mjs <command> [args]\n' +
    '//   bun .output/server/commands.mjs <command> [args]\n' +
    'import { relative } from "node:path";\n' +
    'import { fileURLToPath } from "node:url";\n' +
    '\n' +
    commandAnswerSource(options) +
    '\n' +
    'const argv = process.argv.slice(2);\n' +
    'const program = (process.versions.bun ? "bun" : "node") + " " + relative(process.cwd(), fileURLToPath(import.meta.url));\n' +
    'const answered = answer(argv, program);\n' +
    '\n' +
    'if (answered) {\n' +
    '  (answered.code === 0 ? process.stdout : process.stderr).write(answered.text);\n' +
    '  process.exitCode = answered.code;\n' +
    '} else {\n' +
    '  globalThis[Symbol.for("rsc-kit.command")] = true;\n' +
    '\n' +
    indent(earlySignalsSource()) +
    '\n' +
    '  let code = 1;\n' +
    '\n' +
    '  try {\n' +
    indent(indent(loadAppSource(options.polyfills))) +
    '    code = await runCommand(argv, program);\n' +
    '  } catch (error) {\n' +
    '    // The app failed to load: instrumentation.ts refusing a bad environment,\n' +
    '    // as it would stop the server.\n' +
    '    console.error("[rsc-kit] the app failed to load:", error);\n' +
    '  }\n' +
    '\n' +
    '  process.exit(code);\n' +
    '}\n'
  )
}

/**
 * The entry a binary is compiled from, for an app that has `src/commands`:
 * the server with no arguments, and a command with one.
 *
 * The server's import is dynamic here, and only here. A static import starts
 * the server as it evaluates, before any line of this file could look at
 * `argv`, and a release step run as `./app migrate` would bind the port the
 * running version holds. It is not awaited - a top-level await is what stopped
 * `--bytecode` from applying to this entry - and a literal specifier is one
 * Bun embeds, as it does the static one. The command path chains its imports
 * with `then` for the same reason.
 *
 * Any argument is a command, and an unknown one is refused (exit 2) rather
 * than ignored by a server that starts.
 */
export function compileEntryWithCommands(dirName: string, options: CommandEntryOptions): string {
  // One after another, the polyfills before the entry that needs them.
  // Both literal, so Bun embeds both; which one runs is the command's.
  const app = `(BARE_COMMANDS.includes(argv[0]) ? import("./_ssr/${BARE_COMMANDS_ENVIRONMENT}.mjs") : import("./_ssr/rsc.mjs"))`
  const chain = [...options.polyfills.map((name) => `import(${JSON.stringify(name)})`), app]
    .map((load) => `.then(() => ${load})`)
    .join('\n      ')

  return (
    '// The entry to compile into one binary:\n' +
    '//   bun build --compile --splitting .output/server/compile.mjs --outfile dist/app\n' +
    '//\n' +
    '// --splitting is what lets a worker hold a stop. Bun parses every module in a\n' +
    '// binary before it runs the first line of any, and a stop that arrives in that\n' +
    '// time is the default action (exit 143): splitting makes this file its own\n' +
    '// chunk, which holds the stop for the command from its first line.\n' +
    '//\n' +
    '// ./app starts the server. ./app <command> runs src/commands/<command>.\n' +
    '//\n' +
    '// A binary carries what is imported by name. The server reads its frozen pages\n' +
    '// through a computed import, which a compile cannot see - imported here, they\n' +
    '// travel inside the binary and are handed to the server before it starts.\n' +
    '// The server itself is imported only when no command was named: a static\n' +
    '// import would start it, and bind its port, before argv could be read. Not\n' +
    '// awaited, since a top-level await is what stopped --bytecode from applying.\n' +
    'import { basename } from "node:path";\n' +
    `import "./${inlineModuleName(dirName)}";\n` +
    '\n' +
    commandAnswerSource(options) +
    '\n' +
    'const failed = (what) => (error) => {\n' +
    '  console.error(what, error);\n' +
    '  process.exit(1);\n' +
    '};\n' +
    '\n' +
    'if (process.argv.length <= 2) {\n' +
    '  import("./index.mjs").catch(failed("[rsc-kit] the server failed to start:"));\n' +
    '} else {\n' +
    '  const argv = process.argv.slice(2);\n' +
    '  const program = "./" + basename(process.execPath);\n' +
    '  const answered = answer(argv, program);\n' +
    '\n' +
    '  if (answered) {\n' +
    '    (answered.code === 0 ? process.stdout : process.stderr).write(answered.text);\n' +
    '    process.exitCode = answered.code;\n' +
    '  } else {\n' +
    '    globalThis[Symbol.for("rsc-kit.command")] = true;\n' +
    '\n' +
    indent(indent(earlySignalsSource())) +
    '\n' +
    '    Promise.resolve()\n' +
    `      ${chain}\n` +
    '      .then(({ runCommand }) => runCommand(argv, program))\n' +
    '      .then((code) => process.exit(code), failed("[rsc-kit] the app failed to load:"));\n' +
    '  }\n' +
    '}\n'
  )
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? '  ' + line : line))
    .join('\n')
}
