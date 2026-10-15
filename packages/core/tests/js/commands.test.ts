// App commands: src/commands/<name>.ts, run as `./app <name>`. The runner is
// what decides an exit code, whether register() runs, and how a long-running
// command is stopped - the things a release step and a queue worker lean on.

import { expect, test } from 'bun:test'
import { commandHelp, EARLY_SIGNALS, runCommand, type CommandContext, type CommandEntry, type RunCommandOptions } from '../../src/commands'

type Signals = NonNullable<RunCommandOptions['signals']>

/** A process stand-in: signals are delivered by the test, not the operating system. */
function fakeSignals() {
  const listeners = new Set<() => void>()
  const signals: Signals = {
    on: (_signal, listener) => listeners.add(listener),
    off: (_signal, listener) => listeners.delete(listener),
  }

  return { signals, send: () => [...listeners].forEach((listener) => listener()), listening: () => listeners.size }
}

function harness(commands: Record<string, CommandEntry>, extra: Partial<RunCommandOptions> = {}) {
  const out: string[] = []
  const err: string[] = []
  const calls: string[] = []
  const options: RunCommandOptions = {
    commands,
    ready: async () => void calls.push('register'),
    shutdown: async () => void calls.push('shutdown'),
    program: './app',
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    signals: fakeSignals().signals,
    limit: 50,
    ...extra,
  }

  return { options, out, err, calls, run: (...argv: string[]) => runCommand(argv, options) }
}

const entry = (module: { default?: unknown; register?: unknown }, description?: string): CommandEntry => ({
  load: async () => module,
  description,
})

test('a command gets the arguments after its name, and nothing is success', async () => {
  let received: unknown
  const app = harness({ migrate: entry({ default: async (args: string[]) => void (received = args) }) })

  expect(await app.run('migrate', '--step', '3', 'x y')).toBe(0)
  expect(received).toEqual(['--step', '3', 'x y'])
})

test('a returned number is the exit code', async () => {
  const app = harness({
    check: entry({ default: async () => 3 }),
    sync: entry({ default: () => 0 }),
  })

  expect(await app.run('check')).toBe(3)
  expect(await app.run('sync')).toBe(0)
})

test('a return that is not an exit code fails the command, and says so', async () => {
  for (const returned of ['done', 256, -1, 1.5, true, null]) {
    const app = harness({ odd: entry({ default: async () => returned }) })

    expect(await app.run('odd')).toBe(1)
    expect(app.err.join('')).toContain('returned')
    expect(app.err.join('')).toContain('0 to 255')
  }
})

test('a command that throws exits 1 with the error, not a stack from nowhere', async () => {
  const app = harness({ boom: entry({ default: async () => Promise.reject(new Error('the table is gone')) }) })

  expect(await app.run('boom')).toBe(1)
  expect(app.err.join('')).toContain('the command "boom" failed')
  expect(app.err.join('')).toContain('the table is gone')
})

test('a file with no default export is the command\'s mistake, and the message names the file', async () => {
  const app = harness({ bare: entry({}) })

  expect(await app.run('bare')).toBe(1)
  expect(app.err.join('')).toContain('src/commands/bare has no default export')
})

test('a command whose module fails to load fails with that error', async () => {
  const app = harness({ broken: { load: async () => Promise.reject(new Error('cannot find @repo/database')) } })

  expect(await app.run('broken')).toBe(1)
  expect(app.err.join('')).toContain('cannot find @repo/database')
})

test('an unknown command exits 2 and lists the ones there are', async () => {
  const app = harness({ migrate: entry({ default: () => {} }, 'Apply migrations'), work: entry({ default: () => {} }) })

  expect(await app.run('migrat')).toBe(2)
  expect(app.err.join('')).toContain('Not a command: migrat')
  expect(app.err.join('')).toContain('migrate  Apply migrations')
  expect(app.out).toEqual([])
})

test('a name that is on Object.prototype is not a command', async () => {
  const app = harness({ migrate: entry({ default: () => {} }) })

  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(await app.run(name)).toBe(2)
})

test('no command at all is a usage error; --help is not', async () => {
  const app = harness({ migrate: entry({ default: () => {} }) })

  expect(await app.run()).toBe(2)
  expect(app.err.join('')).toContain('Usage: ./app <command> [args]')

  expect(await app.run('--help')).toBe(0)
  expect(await app.run('-h')).toBe(0)
  expect(app.out.join('')).toContain('migrate')
})

test('--help for a command is the command\'s own', async () => {
  let received: unknown
  const app = harness({ migrate: entry({ default: async (args: string[]) => void (received = args) }) })

  expect(await app.run('migrate', '--help')).toBe(0)
  expect(received).toEqual(['--help'])
  expect(app.out).toEqual([])
})

test('the list is sorted, aligned, and says what an app with none should do', () => {
  expect(
    commandHelp({ work: entry({}), migrate: entry({}, 'Apply migrations'), a: entry({}, 'First') }, './app'),
  ).toBe('Usage: ./app <command> [args]\n\nCommands:\n  a        First\n  migrate  Apply migrations\n  work\n')
  expect(commandHelp({})).toContain('There are no commands: add a file to src/commands.')
})

test('register() is not called unless the command asks for it', async () => {
  const app = harness({
    plain: entry({ default: () => {} }),
    falsy: entry({ default: () => {}, register: 'yes' }),
  })

  expect(await app.run('plain')).toBe(0)
  expect(await app.run('falsy')).toBe(0)
  expect(app.calls).toEqual([])
})

test('a command that exports register = true gets register() first and shutdown() after', async () => {
  const app = harness({
    db: entry({
      register: true,
      default: async () => void app.calls.push('command'),
    }),
  })

  expect(await app.run('db')).toBe(0)
  expect(app.calls).toEqual(['register', 'command', 'shutdown'])
})

test('shutdown() runs after a command that failed, and its own failure does not change the code', async () => {
  const app = harness(
    { db: entry({ register: true, default: async () => 4 }) },
    {
      shutdown: async () => {
        throw new Error('pool already closed')
      },
    },
  )

  expect(await app.run('db')).toBe(4)
  expect(app.err.join('')).toContain('shutdown() failed: pool already closed')
})

test('register() failing is the command failing, and shutdown() is not called for what never opened', async () => {
  const app = harness(
    { db: entry({ register: true, default: async () => void app.calls.push('command') }) },
    {
      ready: async () => {
        throw new Error('database is not up')
      },
    },
  )

  expect(await app.run('db')).toBe(1)
  expect(app.err.join('')).toContain('database is not up')
  expect(app.calls).toEqual([])
})

test('shutdown() that never returns does not hold the process', async () => {
  const app = harness({ db: entry({ register: true, default: () => {} }) }, { shutdown: () => new Promise(() => {}), limit: 30 })
  const started = Date.now()

  expect(await app.run('db')).toBe(0)
  expect(Date.now() - started).toBeLessThan(1000)
})

test('SIGTERM aborts the signal the command was given, and a command that returns then exits 0', async () => {
  const process = fakeSignals()
  const app = harness(
    {
      work: entry({
        register: true,
        default: async (_args: string[], { signal }: { signal: AbortSignal }) => {
          app.calls.push('started')
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
          app.calls.push('stopped')
        },
      }),
    },
    { signals: process.signals, limit: 1000 },
  )

  const running = app.run('work')

  await Bun.sleep(10)
  expect(process.listening()).toBeGreaterThan(0)
  process.send()

  expect(await running).toBe(0)
  expect(app.calls).toEqual(['register', 'started', 'stopped', 'shutdown'])
  expect(process.listening()).toBe(0)
})

test('a command that does not stop within the limit exits 1, and says how long it was given', async () => {
  const process = fakeSignals()
  const app = harness({ stuck: entry({ default: () => new Promise(() => {}) }) }, { signals: process.signals, limit: 30 })
  const running = app.run('stuck')

  await Bun.sleep(5)
  process.send()

  expect(await running).toBe(1)
  expect(app.err.join('')).toContain('did not stop within')
})

test('a second signal does not wait for the limit', async () => {
  const process = fakeSignals()
  const app = harness({ stuck: entry({ default: () => new Promise(() => {}) }) }, { signals: process.signals, limit: 60_000 })
  const running = app.run('stuck')

  await Bun.sleep(5)
  process.send()
  process.send()

  expect(await running).toBe(1)
})

test('the signal listeners are taken off when a command ends, so they do not pile up', async () => {
  const process = fakeSignals()
  const app = harness({ quick: entry({ default: () => {} }) }, { signals: process.signals })

  for (let i = 0; i < 5; i++) await app.run('quick')

  expect(process.listening()).toBe(0)
})

test('a command can see its deadline once told to stop, and not before', async () => {
  const process = fakeSignals()
  const seen: (number | undefined)[] = []
  const app = harness(
    {
      work: entry({
        default: async (_args: string[], context: CommandContext) => {
          seen.push(context.deadline)
          await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve()))
          seen.push(context.deadline)
        },
      }),
    },
    { signals: process.signals, limit: 4000 },
  )
  const running = app.run('work')

  await Bun.sleep(10)

  const before = Date.now()

  process.send()
  expect(await running).toBe(0)

  expect(seen[0]).toBeUndefined()
  // The runner stops waiting `limit` after it was told: what a worker finishing a job budgets against.
  expect(seen[1]).toBeGreaterThanOrEqual(before + 4000)
  expect(seen[1]).toBeLessThanOrEqual(Date.now() + 4000)
})

/**
 * What the entry that loads the app leaves behind: the process's signals are
 * its, `count` came before the runner, and `send` is a later one.
 */
function leaveEarly(count: number) {
  let listener: (() => void) | undefined
  let handoffs = 0
  const early = {
    count,
    handoff: (next: (() => void) | undefined) => {
      handoffs += 1
      listener = next
    },
  }

  ;(globalThis as Record<symbol, unknown>)[EARLY_SIGNALS] = early

  return {
    handoffs: () => handoffs,
    holding: () => listener !== undefined,
    send: () => listener?.(),
    clear: () => delete (globalThis as Record<symbol, unknown>)[EARLY_SIGNALS],
  }
}

test('a stop that arrived while the app was loading is a stop: the command starts already told', async () => {
  const early = leaveEarly(1)
  let aborted: boolean | undefined
  const app = harness({
    work: entry({
      default: async (_args: string[], { signal }: { signal: AbortSignal }) => {
        aborted = signal.aborted
      },
    }),
  })

  try {
    expect(await app.run('work')).toBe(0)
    expect(aborted).toBe(true)
    // Handed over to, and handed back: the entry's listener is the only one.
    expect(early.handoffs()).toBe(2)
    expect(early.holding()).toBe(false)
  } finally {
    early.clear()
  }
})

test('behind an entry the runner adds no listener of its own, so a signal is counted once', async () => {
  const early = leaveEarly(0)
  const process = fakeSignals()
  let stoppedBy: boolean | undefined
  const app = harness(
    {
      work: entry({
        default: async (_args: string[], { signal }: { signal: AbortSignal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
          stoppedBy = signal.aborted
        },
      }),
    },
    { signals: process.signals, limit: 1000 },
  )

  try {
    const running = app.run('work')

    await Bun.sleep(10)
    expect(early.holding()).toBe(true)
    expect(process.listening()).toBe(0)

    early.send()

    expect(await running).toBe(0)
    expect(stoppedBy).toBe(true)
  } finally {
    early.clear()
  }
})

test('a command that does not stop is still ended when the stop came early', async () => {
  const early = leaveEarly(1)
  const app = harness({ stuck: entry({ default: () => new Promise(() => {}) }) }, { limit: 30 })

  try {
    expect(await app.run('stuck')).toBe(1)
    expect(app.err.join('')).toContain('did not stop within')
  } finally {
    early.clear()
  }
})

test('two early stops are a person who meant it, and nothing waits', async () => {
  const early = leaveEarly(2)
  const app = harness({ stuck: entry({ default: () => new Promise(() => {}) }) }, { limit: 60_000 })

  try {
    expect(await app.run('stuck')).toBe(1)
  } finally {
    early.clear()
  }
})
