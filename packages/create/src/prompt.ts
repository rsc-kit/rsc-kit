// Prompts, with no dependency.
//
// A create- package is run through `bunx`/`npm create`, which installs it
// first — so every dependency is latency the user waits through before being
// asked anything. readline is in both runtimes and costs nothing.

import { createInterface, emitKeypressEvents } from 'node:readline'
import { createInterface as createPromised } from 'node:readline/promises'
import { exit, stdin, stdout } from 'node:process'

const tty = stdout.isTTY === true
const c = (code: string, text: string) => (tty ? code + text + '\x1b[0m' : text)

export const dim = (t: string) => c('\x1b[2m', t)
export const bold = (t: string) => c('\x1b[1m', t)
export const cyan = (t: string) => c('\x1b[36m', t)
const green = (t: string) => c('\x1b[32m', t)

const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
/** Up n lines, then clear everything below. */
const rewind = (n: number) => `\x1b[${n}A\x1b[0J`

export interface Choice<T> {
  value: T
  label: string
  hint: string
}

export class Prompter {
  /**
   * Asked one at a time rather than over one long-lived interface.
   *
   * `select` takes stdin into raw mode to read arrow keys, and a readline
   * interface left open would be consuming the same stream — the two fight
   * over every keypress. Opening and closing per question keeps exactly one
   * reader attached at a time.
   */
  private async ask(question: string): Promise<string> {
    const rl = createPromised({ input: stdin, output: stdout })

    try {
      return (await rl.question(question)).trim()
    } finally {
      rl.close()
    }
  }

  async text(question: string, fallback: string): Promise<string> {
    const answer = await this.ask(`${bold(question)} ${dim(`(${fallback})`)} `)

    return answer === '' ? fallback : answer
  }

  async confirm(question: string, fallback: boolean): Promise<boolean> {
    const answer = (await this.ask(`${bold(question)} ${dim(fallback ? '(Y/n)' : '(y/N)')} `)).toLowerCase()

    if (answer === '') return fallback

    return answer.startsWith('y')
  }

  /** Arrow keys, j/k, or the number — whichever the hands reach for first. */
  select<T>(question: string, choices: Choice<T>[]): Promise<T> {
    let index = 0

    const draw = (first: boolean) => {
      const lines = choices.map((choice, i) => {
        const on = i === index
        const marker = on ? green('●') : dim('○')
        const label = on ? bold(choice.label) : choice.label

        return `  ${marker} ${label}  ${dim(choice.hint)}`
      })

      stdout.write((first ? '' : rewind(choices.length)) + lines.join('\n') + '\n')
    }

    stdout.write(`${bold(question)} ${dim('↑↓ then enter')}\n`)
    stdout.write(HIDE_CURSOR)
    draw(true)

    /**
     * Replace the whole list with the answer.
     *
     * Left on screen, every question's options stay in the transcript and the
     * next question is pushed off the top — by the last one you cannot see
     * what you picked for the first.
     */
    const collapse = (choice: Choice<T>) => {
      stdout.write(rewind(choices.length + 1) + `${green('✓')} ${bold(question)} ${cyan(choice.label)}\n`)
    }

    // Its own interface so keypress events are emitted at all; the promised
    // one above is closed by the time this runs.
    const rl = createInterface({ input: stdin, escapeCodeTimeout: 50 })

    emitKeypressEvents(stdin, rl)

    const wasRaw = stdin.isRaw === true

    if (stdin.isTTY) stdin.setRawMode(true)

    return new Promise<T>((resolve) => {
      const done = () => {
        stdin.off('keypress', onKey)
        if (stdin.isTTY) stdin.setRawMode(wasRaw)
        rl.close()
        stdout.write(SHOW_CURSOR)
      }

      const onKey = (str: string, key: { name?: string; ctrl?: boolean }) => {
        const last = choices.length - 1

        // Ctrl-C has to be handled here: raw mode means no SIGINT, so without
        // this the only way out of the prompt is closing the terminal.
        if (key?.ctrl && key.name === 'c') {
          done()
          stdout.write('\n')
          exit(130)
        }

        if (key?.name === 'up' || key?.name === 'k') index = index === 0 ? last : index - 1
        else if (key?.name === 'down' || key?.name === 'j') index = index === last ? 0 : index + 1
        else if (key?.name === 'home') index = 0
        else if (key?.name === 'end') index = last
        else if (key?.name === 'return' || key?.name === 'enter') {
          done()
          collapse(choices[index])
          resolve(choices[index].value)

          return
        } else if (/^[1-9]$/.test(str ?? '')) {
          const picked = Number(str) - 1

          if (picked > last) return

          done()
          collapse(choices[picked])
          resolve(choices[picked].value)

          return
        } else return

        draw(false)
      }

      stdin.on('keypress', onKey)
    })
  }

  close(): void {
    // Nothing is held open between questions.
  }
}
