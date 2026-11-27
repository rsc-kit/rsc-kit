// The half of the contract a build uses: the adapter's command, answering
// rpc() while pages are prerendered (buildProcess.ts).
//
// What it has to get right is the line between two answers. A function whose
// answer is the same for everyone is answered, as the endpoint would; one that
// read who is asking is said to have, because a build that stored a guest's
// answer would show it to every visitor. Asked of the same Conformance.*
// functions as the endpoint, so an adapter registers nothing more.

import { spawn } from 'node:child_process'
import { buildProcess } from './buildProcess.js'
import { visitorRead, type BuildAnswer } from './buildScope.js'
import type { ConformanceResult } from './conformance.js'
import { interpretReply } from './hostCalls.js'
import { isNotFoundSignal } from './notFound.js'
import { withRedirect } from './redirect.js'

/** Every function that reads, or sets, something of one visitor's. */
const VISITORS: Record<string, string> = {
  'Conformance.cookie': 'the Cookie header',
  'Conformance.authorization': 'the Authorization header',
  'Conformance.ip': "the visitor's address",
  'Conformance.userAgent': "the visitor's browser",
  'Conformance.login': 'setting a cookie',
  'Conformance.flash': 'flashing a message',
  'Conformance.unauthenticated': 'refusing who is not signed in',
  'Conformance.unauthorized': 'refusing who may not',
}

export async function buildConformance(
  command: string[],
  options: { cwd?: string; timeoutMs?: number; leftOut?: string[] } = {},
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = []
  const cwd = options.cwd ?? process.cwd()
  const timeoutMs = options.timeoutMs ?? 30_000
  const backend = buildProcess({ command, cwd, timeoutMs, print: () => {} })

  const expect = (ok: boolean, detail: string) => {
    if (!ok) throw new Error(detail)
  }

  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run()
      results.push({ case: 'a build: ' + name, ok: true })
    } catch (error) {
      results.push({ case: 'a build: ' + name, ok: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }

  /** The answer as a render gets it: a value, or what is thrown. */
  const value = async (name: string, ...args: unknown[]): Promise<unknown> => {
    const answer = await backend.ask(name, args)

    expect(!visitorRead(answer), `${name} was said to need a visitor: ${JSON.stringify(answer)}`)

    return interpretReply(name, answer as Exclude<BuildAnswer, { visitor: string[] }>, () => {})
  }

  const thrown = async (name: string): Promise<unknown> => {
    let answered: unknown

    try {
      answered = await value(name)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(name + ' was said to')) throw error

      return error
    }

    throw new Error(name + ' answered ' + JSON.stringify(answered))
  }

  try {
    await check('what is the same for everyone is answered', async () => {
      const shape = { list: [1, 'ü', null, true, { nested: [] }], text: 'a\nb' }
      const echoed = await value('Conformance.echo', shape)

      expect(JSON.stringify(echoed) === JSON.stringify(shape), 'echo answered ' + JSON.stringify(echoed))

      const none = await value('Conformance.emptyList')

      expect(Array.isArray(none) && none.length === 0, 'emptyList answered ' + JSON.stringify(none))
      expect(Date.parse(String(await value('Conformance.time'))) === Date.parse('2026-01-02T03:04:05Z'), 'the time arrived as another')
      expect((await value('Conformance.double', 21)) === 42, 'double(21) is not 42')
    })

    for (const [name, what] of Object.entries(VISITORS)) {
      // An optional case the adapter's manifest leaves out: its framework does the job.
      if (options.leftOut?.includes(name)) continue

      await check(`${what} needs a visitor (${name})`, async () => {
        const answer = await backend.ask(name, [])

        expect(visitorRead(answer) !== null, 'it was answered, and would be stored for everyone: ' + JSON.stringify(answer))
      })
    }

    await check('calls asked after one that needed a visitor are still answered', async () => {
      const [, after] = await Promise.all([backend.ask('Conformance.cookie', ['again']), value('Conformance.echo', 'after a visitor')])

      expect(after === 'after a visitor', 'got ' + JSON.stringify(after))
    })

    await check('many calls at once are each answered with their own', async () => {
      const answers = await Promise.all(Array.from({ length: 40 }, (_, i) => value('Conformance.double', 100 + i)))

      expect(answers.every((answer, i) => answer === 2 * (100 + i)), JSON.stringify(answers))
    })

    await check('a failure carries its message', async () => {
      const error = await thrown('Conformance.fail')

      expect(error instanceof Error && error.message.includes('boom'), 'got ' + String(error))
    })

    await check('not found, a refusal, refused input and a redirect keep their shape', async () => {
      expect(isNotFoundSignal(await thrown('Conformance.notFound')), 'notFound is not not-found')

      const refused = (await thrown('Conformance.refuse')) as { refusalStatus?: number }

      expect(refused.refusalStatus === 429, 'refuse came back as ' + String(refused))

      const invalid = (await thrown('Conformance.invalid')) as { errors?: Record<string, string[]> }

      expect(Array.isArray(invalid.errors?.name), 'invalid came back as ' + String(invalid))

      const taken = await withRedirect(async (seen) => {
        await thrown('Conformance.redirect')

        return seen()
      })

      expect(taken?.location === '/login', 'redirect ' + JSON.stringify(taken))
    })

    await check('a function nobody registered is an error, not a visitor', async () => {
      const error = await thrown('Conformance.nobodyRegisteredThis')

      expect(error instanceof Error, 'got ' + String(error))
    })
  } finally {
    backend.close()
  }

  // Over the wire, for what a well-behaved client never sends.
  await check('a line that is not a call does not end the process', async () => {
    const answers = await raw(command, cwd, timeoutMs, [
      'not json',
      '{"id":1}',
      JSON.stringify({ id: 2, function: 'Conformance.echo', args: ['still here'] }),
    ])

    expect(
      answers.some((a) => a.id === 2 && a.result === 'still here'),
      'the call after it was not answered: ' + JSON.stringify(answers),
    )
  })

  await check('the process ends when its input does', async () => {
    await raw(command, cwd, timeoutMs, [])
  })

  return results
}

/** Every answer to these lines, once the process ended by itself. */
function raw(command: string[], cwd: string, timeoutMs: number, lines: string[]): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { cwd, stdio: ['pipe', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`still running ${Math.round(timeoutMs / 1000)}s after its input ended`))
    }, timeoutMs)

    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (text: string) => (out += text))
    child.stdin.on('error', () => {})
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(
        out.split('\n').flatMap((line) => {
          try {
            return line.trim() ? [JSON.parse(line) as Record<string, unknown>] : []
          } catch {
            return []
          }
        }),
      )
    })

    child.stdin.end(lines.map((line) => line + '\n').join(''))
  })
}
