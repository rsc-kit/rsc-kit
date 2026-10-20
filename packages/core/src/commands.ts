/**
 * App commands: the files in `src/commands`, run as `./app <name>`.
 *
 * A compiled app is one binary that starts a server, and a release step or a
 * queue worker is the same code started differently - `./app migrate`,
 * `./app work`. The same entry also runs from a plain build, as
 * `node .output/server/commands.mjs <name>`, so nothing about a command
 * depends on Bun, on a platform, or on the binary.
 *
 * Each command is a file with a default export, `(args, context) => number
 * | void`, where `context` is `{ signal, deadline }`. It shares the build's code and dependencies, so the database
 * package and the logger the pages use are the ones it uses, in the same
 * bundle. It is loaded only when it is named: the server never evaluates one.
 *
 * `register()` from instrumentation.ts is skipped unless the command says
 * `export const register = true`. Importing instrumentation.ts is not
 * skipped - a bad environment fails there, at import, for a command as for a
 * server - but a command that only needs the schema should not pay for, or
 * fail on, a connection it never uses.
 *
 * Nothing here imports `node:` anything: the runner is bundled into the
 * server's entry for every host, and a host without those modules must still
 * load it. `process` is reached lazily, inside the functions that need it.
 */

/**
 * Set on `globalThis` before the server's entry is imported, by whatever runs
 * a command. The entry would otherwise call register() the moment it loads, as
 * a server does at startup, which a command has not asked for.
 */
export const COMMAND_MODE = Symbol.for('rsc-kit.command')

/** What a command receives beside its arguments. */
export interface CommandContext {
  /** Aborted by SIGTERM or SIGINT: a long-running command stops when it is. */
  signal: AbortSignal
  /**
   * When the runner stops waiting for the command, as a time in milliseconds
   * (`Date.now()`'s), once it has been told to stop; undefined until then.
   * A worker finishing its job reads `deadline - Date.now()` rather than
   * RSC_SHUTDOWN_TIMEOUT and its default.
   *
   * A getter, because what it answers changes: read `context.deadline` when
   * you need it. `({ deadline }) => ...` reads it once, as the command
   * starts, when it is always undefined, and keeps that.
   */
  readonly deadline: number | undefined
}

/** A command's default export. */
export type CommandFunction = (args: string[], context: CommandContext) => number | void | Promise<number | void>

/**
 * Types a command's default export, so its arguments and context are known
 * without annotating them: `export default defineCommand(async (args, context) => {})`.
 * It returns what it is given.
 */
export function defineCommand(command: CommandFunction): CommandFunction {
  return command
}

/** Resolves after the event loop has taken a turn, which is when it hands out the signals that arrived while it was busy. */
const nextTurn = () => new Promise<void>((resolve) => (typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0)))

/**
 * The entry that loads the app owns the process's SIGTERM and SIGINT, and
 * leaves this on `globalThis` for the runner.
 *
 * Loading can take a while, and a signal before the runner exists finds only
 * the default action, which ends the process with 143. So the entry holds
 * them, and the runner is handed over to: the count of those that came first,
 * and every later one. The entry's listener is never taken off. A signal is
 * delivered on the event loop's next turn, not when it arrives, and a listener
 * removed in between has the signal taken from it without anyone getting it.
 */
export const EARLY_SIGNALS = Symbol.for('rsc-kit.command.signals')

interface EarlySignals {
  /** Stops that arrived before there was a runner to give them to. */
  count: number
  /** From now on, the entry gives each signal to this, and stops holding the process to its own timeout. */
  handoff: (listener: (() => void) | undefined) => void
}

/** What the build knows of one command file: how to load it, and a line to list it by. */
export interface CommandEntry {
  load: () => Promise<{ default?: unknown; register?: unknown }>
  description?: string
}

export interface RunCommandOptions {
  commands: Record<string, CommandEntry>
  /** instrumentation.ts's register(), once. Awaited only for a command that exports `register = true`. */
  ready: () => Promise<unknown>
  /** instrumentation.ts's shutdown(), called after a command that was given `register()`. */
  shutdown?: () => unknown
  /** How the usage line names this program: `./app`, `node .output/server/commands.mjs`. */
  program?: string
  out?: (text: string) => void
  err?: (text: string) => void
  /** SIGTERM and SIGINT. The process, unless a test brings its own. */
  signals?: {
    on: (signal: 'SIGTERM' | 'SIGINT', listener: () => void) => unknown
    off: (signal: 'SIGTERM' | 'SIGINT', listener: () => void) => unknown
  }
  /** Milliseconds a command gets to stop once told to, and shutdown() after it. RSC_SHUTDOWN_TIMEOUT seconds (10) by default. */
  limit?: number
}

/** Whether this process was started to run a command rather than to serve. */
export function inCommandMode(): boolean {
  return Boolean((globalThis as Record<symbol, unknown>)[COMMAND_MODE])
}

/** The list `--help` prints, and what an unknown name is answered with. */
export function commandHelp(commands: Record<string, { description?: string }>, program = 'app'): string {
  const names = Object.keys(commands).sort()
  const width = Math.max(0, ...names.map((name) => name.length))
  const rows = names.map((name) => {
    const description = commands[name]?.description

    return description ? `  ${name.padEnd(width)}  ${description}` : `  ${name}`
  })

  return (
    `Usage: ${program} <command> [args]\n\n` +
    (rows.length ? `Commands:\n${rows.join('\n')}\n` : 'There are no commands: add a file to src/commands.\n')
  )
}

/**
 * An exit code from what a command returned. Nothing is success; a number is
 * the code. Anything else is the command's mistake, and said so, because the
 * alternative is a process that exits 0 after returning a string.
 */
function exitCodeOf(result: unknown, name: string): number {
  if (result === undefined) return 0

  if (typeof result === 'number' && Number.isInteger(result) && result >= 0 && result <= 255) return result

  throw new TypeError(
    `the command "${name}" returned ${JSON.stringify(result)}. A command returns an exit code from 0 to 255, or nothing.`,
  )
}

function unref(timer: unknown): void {
  const handle = timer as { unref?: () => void } | undefined

  if (handle && typeof handle.unref === 'function') handle.unref()
}

/** The seconds a command and its shutdown() get after a signal, in milliseconds. */
function defaultLimit(): number {
  const seconds = Number(typeof process !== 'undefined' ? process.env.RSC_SHUTDOWN_TIMEOUT : undefined)

  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 10) * 1000
}

/**
 * Run the command `argv` names and say how it ended.
 *
 * Resolves to the exit code and leaves exiting to the caller, so a test sees
 * the code and an entry decides when the process stops. 0 is success and 1 is
 * a command that threw or would not stop; 2 is a name that is not a command,
 * as it is for a tool that was misused.
 */
export async function runCommand(argv: readonly string[], options: RunCommandOptions): Promise<number> {
  const out = options.out ?? ((text: string) => void process.stdout.write(text))
  const err = options.err ?? ((text: string) => void process.stderr.write(text))
  const [name, ...args] = argv

  if (name === '--help' || name === '-h') {
    out(commandHelp(options.commands, options.program))

    return 0
  }

  if (name === undefined) {
    err(commandHelp(options.commands, options.program))

    return 2
  }

  const command = Object.hasOwn(options.commands, name) ? options.commands[name] : undefined

  if (!command) {
    err(`Not a command: ${name}\n\n${commandHelp(options.commands, options.program)}`)

    return 2
  }

  const limit = options.limit ?? defaultLimit()
  const signals = options.signals ?? (typeof process !== 'undefined' ? process : undefined)
  const controller = new AbortController()

  let registered = false
  let stop: ((code: number) => void) | undefined
  let stopTimer: unknown
  let deadline: number | undefined
  let signalled = 0
  const context: CommandContext = {
    signal: controller.signal,
    get deadline() {
      return deadline
    },
  }

  // The first signal asks the command to stop and gives it `limit` to do so,
  // as the server gives in-flight requests theirs. The second is a person who
  // meant it, and nothing waits.
  const onSignal = () => {
    signalled += 1

    if (signalled === 1) {
      deadline = Date.now() + limit
      controller.abort()

      stopTimer = setTimeout(() => {
        err(`[rsc-kit] the command "${name}" did not stop within ${limit / 1000} seconds.\n`)
        stop?.(1)
      }, limit)

      unref(stopTimer)

      return
    }

    stop?.(1)
  }

  const stopped = new Promise<number>((resolve) => {
    stop = resolve
  })

  // Behind an entry that loaded the app, the process's signals are the
  // entry's: it hands each one over, and what came while the app was loading
  // is counted here. Told to stop while loading is told to stop.
  const early = (globalThis as Record<symbol, EarlySignals | undefined>)[EARLY_SIGNALS]

  if (early) {
    early.handoff(onSignal)

    for (let caught = 0; caught < early.count; caught++) onSignal()
  } else {
    signals?.on('SIGTERM', onSignal)
    signals?.on('SIGINT', onSignal)
  }

  // A command that is only waiting - for its signal, for a message that has
  // not come - holds nothing open, and Node answers an event loop with nothing
  // in it by exiting 13 with a warning about an unsettled await, where Bun
  // simply waits. A command that is running is running until it returns.
  const alive = setInterval(() => {}, 2 ** 30)

  const ran = (async (): Promise<number> => {
    try {
      const module = await command.load()

      if (typeof module.default !== 'function') {
        throw new TypeError(`src/commands/${name} has no default export. Export a function: export default async (args) => {}`)
      }

      // Opted in, and only then: a migration that needs the schema should not
      // fail because the queue it never touches is not up.
      if (module.register === true) {
        await options.ready()
        registered = true
      }

      // A stop that arrived while the loop was busy with a synchronous load has
      // not been delivered: a signal is delivered on the loop's next turn. One
      // turn here, so that the command is told before it starts rather than a
      // moment after - the same on Node, on Bun and in a binary.
      await nextTurn()

      return exitCodeOf(await (module.default as (...a: unknown[]) => unknown)(args, context), name)
    } catch (error) {
      err(`[rsc-kit] the command "${name}" failed: ${describeError(error, true)}\n`)

      return 1
    }
  })()

  let code: number

  try {
    code = await Promise.race([ran, stopped])
  } finally {
    clearInterval(alive)
    clearTimeout(stopTimer as Parameters<typeof clearTimeout>[0])

    if (early) early.handoff(undefined)
    else {
      signals?.off('SIGTERM', onSignal)
      signals?.off('SIGINT', onSignal)
    }
  }

  // What register() opened is closed here, bounded like the server's: a
  // close that hangs must not hold a release step open.
  if (registered && options.shutdown) {
    let timer: unknown

    await Promise.race([
      Promise.resolve()
        .then(() => options.shutdown?.())
        .catch((error) => err(`[rsc-kit] instrumentation.ts shutdown() failed: ${describeError(error, false)}\n`)),
      new Promise((resolve) => {
        timer = setTimeout(resolve, limit)
        unref(timer)
      }),
    ])

    clearTimeout(timer as Parameters<typeof clearTimeout>[0])
  }

  return code
}

/**
 * An error and every cause under it, one line of `[cause]:` each.
 *
 * A library that wraps an error keeps the reason in `cause`, and a stack does
 * not print it: Drizzle's DrizzleQueryError carries the SQL as its message and
 * the database's refusal - a timeout, a wrong password - as its cause, so a
 * failed migration said what it tried and never why. A cause that is not an
 * Error is printed as it is, and a chain that loops back stops there.
 */
function describeError(error: unknown, stack: boolean): string {
  const seen = new Set<unknown>()
  const parts: string[] = []
  let current: unknown = error

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    parts.push(
      current instanceof Error ? (stack ? (current.stack ?? `${current.name}: ${current.message}`) : current.message) : String(current),
    )
    current = current instanceof Error ? current.cause : undefined
  }

  return parts.join('\n[cause]: ')
}
