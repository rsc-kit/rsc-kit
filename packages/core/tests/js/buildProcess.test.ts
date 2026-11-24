// The backend's process that answers a build's rpc() calls, against one that
// does what an adapter's does - and what an app inside it can do by accident.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProcess, type BuildProcessOptions } from '../../src/buildProcess'

const backend = join(import.meta.dir, '../fixtures/build-backend/backend.mjs')

let dir: string
let log: string
let printed: string
let running: ReturnType<typeof buildProcess>

function start(extra: string[] = [], options: Partial<BuildProcessOptions> = {}) {
  running = buildProcess({
    command: [process.execPath, backend, log, ...extra],
    cwd: dir,
    print: (text) => (printed += text),
    ...options,
  })

  return running
}

const asked = () => readFileSync(log, 'utf-8').trim().split('\n')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rsc-build-process-'))
  log = join(dir, 'log')
  printed = ''
})

afterEach(() => {
  running?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('a build asking the backend', () => {
  test('matches answers to calls, in whatever order they come', async () => {
    const { ask } = start()
    const [late, echo] = await Promise.all([ask('late', []), ask('echo', [1, 'ü'])])

    expect(late).toEqual({ status: 200, reply: { result: 'late' }, text: '{"result":"late"}' })
    expect((echo as { reply: unknown }).reply).toEqual({ result: [1, 'ü'] })
    expect(asked()).toHaveLength(3)
  })

  test('asks once for the same call, and hands each caller its own answer', async () => {
    const { ask } = start()
    const first = (await ask('object', [])) as any

    first.reply.result.list.push('changed by a render')

    expect(((await ask('object', [])) as any).reply.result).toEqual({ list: [] })

    await ask('object', [1])

    expect(asked()).toEqual(['start', 'object[]', 'object[1]'])
  })

  test('asks a new process what the last one left, and does not ask again about a function that reads the visitor', async () => {
    const { ask } = start()
    const [session, echo, again] = await Promise.all([ask('session', [1]), ask('echo', ['x']), ask('session', [2])])

    expect(session).toEqual({ visitor: ['the session'] })
    expect((echo as any).reply.result).toEqual(['x'])
    expect(again).toEqual({ visitor: ['the session'] })
    expect(await ask('session', [3])).toEqual({ visitor: ['the session'] })
    expect(asked()).toEqual(['start', 'session[1]', 'start', 'echo["x"]'])
  })

  test('keeps a process that says a call needs a visitor and goes on', async () => {
    const { ask } = start()

    expect(await ask('visitor', [])).toEqual({ visitor: ['a request header'] })
    await ask('echo', [])
    expect(asked()).toEqual(['start', 'visitor[]', 'echo[]'])
  })

  test('passes on what the app prints, and is not confused by it', async () => {
    const { ask } = start()

    expect(((await ask('noisy', [])) as any).reply.result).toBe('answered')
    await ask('echo', [])
    await Bun.sleep(50)
    expect(printed).toContain('dumped without a newline')
    expect(printed).toContain('not asked')
    expect(printed).toContain('a warning')
  })

  test('says which call was being answered when the process died, and carries on with the next', async () => {
    const { ask } = start()

    await ask('echo', [])
    await expect(ask('dies', [])).rejects.toThrow(/ended with code 255 while answering rpc\("dies"\).*\nAllowed memory size exhausted/s)
    expect(((await ask('echo', [2])) as any).reply.result).toEqual([2])
  })

  test('does not start a backend that cannot boot once per call', async () => {
    const { ask } = start(['boot-fails'])

    await expect(ask('echo', [])).rejects.toThrow(/ended with code 7 .*no such table: plans/s)
    await expect(ask('echo', [2])).rejects.toThrow('no such table: plans')
    expect(asked()).toEqual(['start'])
  })

  test('says so when the command is not there', async () => {
    const { ask } = start([], { command: ['no-such-command-here'] })

    await expect(ask('echo', [])).rejects.toThrow(/could not be started/)
  })

  test('gives up on a backend that never answers', async () => {
    const { ask } = start([], { timeoutMs: 400 })

    await expect(ask('never', [])).rejects.toThrow('gave no answer for 0s while answering rpc("never")')
  })

  test('answers nothing after the build', async () => {
    const { ask, close } = start()

    close()
    await expect(ask('echo', [])).rejects.toThrow('after the build ended')
  })
})
