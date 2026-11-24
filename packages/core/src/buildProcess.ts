// The backend's process that answers a build's rpc() calls.
//
// A command rather than the host-call endpoint: a build runs where the app is
// not being served - CI, a container being made - and the backend's own
// command is already how it is asked for its manifest there. One JSON object
// a line, each way:
//
//     > {"id":1,"function":"Posts.all","args":[]}
//     < {"id":1,"status":200,"result":[...]}
//     < {"id":2,"visitor":["the session"]}
//
// In any order, matched by id. An answer with "last": true is the last this
// process gives - the backend's way of saying its state is no longer anyone's
// - and what it had not answered is asked of a new one. A line that is not an
// answer is something the app printed, and is passed on.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { HostCallReply } from './hostCalls.js'
import { saidCall, type BuildAnswer, type BuildAnswerer } from './buildScope.js'

export interface BuildProcessOptions {
  command: string[]
  cwd: string
  /** How long without any answer before the build gives up. */
  timeoutMs?: number
  /** Where what the app prints goes. */
  print?: (text: string) => void
}

interface Waiting {
  id: number
  name: string
  line: string
  resolve: (text: string) => void
  reject: (error: Error) => void
}

const STDERR_TAIL = 4_000

export function buildProcess(options: BuildProcessOptions): BuildAnswerer & { close(): void } {
  const { command, cwd, timeoutMs = 60_000, print = (text) => process.stderr.write(text) } = options

  // Answers by call and arguments, so every render of a page - its shell, the
  // whole page, each segment - holds the same one. As text, parsed for each:
  // a render may change what it was given.
  const answers = new Map<string, Promise<string>>()
  // Functions that read the visitor, by name: what a function reads does not
  // depend on which of five hundred posts it was asked about, and asking each
  // would end a process each time.
  const visitors = new Map<string, string>()
  const waiting = new Map<number, Waiting>()

  let child: ChildProcessWithoutNullStreams | null = null
  let nextId = 1
  let closed = false
  let broken: Error | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const shown = command.join(' ')

  /** Give up when nothing at all has been answered for too long. */
  function watch(): void {
    clearTimeout(timer)
    if (waiting.size === 0) return

    timer = setTimeout(() => {
      const process = child

      child = null
      process?.kill()
      failAll(`gave no answer for ${Math.round(timeoutMs / 1000)}s`, '')
    }, timeoutMs)
  }

  function failAll(why: string, stderr: string): void {
    const calls = [...waiting.values()]

    waiting.clear()
    clearTimeout(timer)

    const names = [...new Set(calls.map((call) => saidCall(call.name)))]
    const error = new Error(
      `The backend's build process ${why} while answering ${names.slice(0, 3).join(', ')}` +
        (names.length > 3 ? ` and ${names.length - 3} more` : '') +
        ` (${shown}).` + (stderr.trim() ? `\n${stderr.trim()}` : ''),
    )

    for (const call of calls) call.reject(error)

    broken = error
  }

  function start(): ChildProcessWithoutNullStreams {
    const [file, ...args] = command
    const started = spawn(file!, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    let buffered = ''
    let answered = false

    const ended = (why: string) => {
      if (child !== started) return

      child = null
      if (closed || waiting.size === 0) return

      failAll(why, stderr)
      // A process that answered and then died took its calls with it. One
      // that never answered will not the next time either.
      if (answered) broken = null
    }

    started.stdout.setEncoding('utf-8')
    started.stderr.setEncoding('utf-8')

    started.stderr.on('data', (text: string) => {
      stderr = (stderr + text).slice(-STDERR_TAIL)
      print(text)
    })

    started.stdout.on('data', (text: string) => {
      buffered += text

      let at: number

      while ((at = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, at)

        buffered = buffered.slice(at + 1)
        if (line.trim() !== '' && !take(line, started)) print(line + '\n')
        else if (line.trim() !== '') answered = true
      }
    })

    // A process that went away is reported by its exit, not by the write.
    started.stdin.on('error', () => {})
    started.on('error', (error) => ended(`could not be started: ${error.message}`))
    // close rather than exit: its last lines may still be in the pipe.
    started.on('close', (code, signal) => {
      if (buffered.trim() !== '' && take(buffered, started)) answered = true
      ended(signal ? `was stopped by ${signal}` : `ended with code ${code}`)
    })

    return started
  }

  /** One line, if it is an answer to a call still waiting. */
  function take(line: string, from: ChildProcessWithoutNullStreams): boolean {
    let parsed: { id?: unknown; visitor?: unknown; last?: unknown }

    try {
      parsed = JSON.parse(line) as typeof parsed
    } catch {
      return false
    }

    const call = typeof parsed?.id === 'number' ? waiting.get(parsed.id) : undefined

    // From a process already given up on: its calls were asked again.
    if (!call || child !== from) return false

    waiting.delete(call.id)
    if (Array.isArray(parsed.visitor)) visitors.set(call.name, line)
    call.resolve(line)

    if (parsed.last === true) {
      child = null
      from.stdin.end()
      again()
    }

    watch()

    return true
  }

  /** Ask a new process what the last one left. */
  function again(): void {
    for (const call of [...waiting.values()]) {
      const known = visitors.get(call.name)

      if (known !== undefined) {
        waiting.delete(call.id)
        call.resolve(known)
      }
    }

    if (waiting.size === 0) return

    child = start()

    for (const call of waiting.values()) child.stdin.write(call.line)
  }

  function send(name: string, args: unknown[]): Promise<string> {
    if (closed) return Promise.reject(new Error(`${saidCall(name)} was made after the build ended.`))
    if (broken) return Promise.reject(broken)

    return new Promise<string>((resolve, reject) => {
      const id = nextId++
      const line = JSON.stringify({ id, function: name, args }) + '\n'

      waiting.set(id, { id, name, line, resolve, reject })
      child ??= start()
      child.stdin.write(line)
      if (waiting.size === 1) watch()
    })
  }

  return {
    async ask(name, args) {
      const known = visitors.get(name)

      if (known !== undefined) return read(known)

      const key = JSON.stringify([name, args])
      let answer = answers.get(key)

      if (!answer) {
        answer = send(name, args)
        answers.set(key, answer)
      }

      return read(await answer)
    },
    close() {
      closed = true
      clearTimeout(timer)

      const process = child

      child = null
      if (!process) return

      // Its input ending is what ends it. A kill reaches the command and not
      // what the command started - a wrapper's own child - which would hold
      // these pipes, and the build with them. One still answering a call
      // nobody is waiting for any more is stopped.
      process.stdin.end()
      if (waiting.size > 0) process.kill()
      process.stdout.destroy()
      process.stderr.destroy()
      process.unref()
    },
  }
}

/** A line, as an answer. */
function read(line: string): BuildAnswer {
  const { id: _, last: __, visitor, status, ...reply } = JSON.parse(line) as HostCallReply & {
    id: number
    last?: boolean
    visitor?: unknown
    status?: number
  }

  if (Array.isArray(visitor)) return { visitor: visitor.map(String) }

  return { status: typeof status === 'number' ? status : 200, reply, text: JSON.stringify(reply) }
}
