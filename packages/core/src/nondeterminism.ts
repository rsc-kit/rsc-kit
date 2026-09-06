// Catching a value that will not be the same tomorrow.
//
// A page frozen at build time keeps whatever it rendered. If that render called
// `new Date()` or `Math.random()`, the frozen page keeps *that* date and *that*
// number, and serves them to everyone until the next build — a "3 minutes ago"
// that is three minutes past a moment in the deployment pipeline.
//
// Nothing warns, because nothing failed. The page rendered perfectly.
//
// This is the same trick the prerenderer already plays on the host call: watch
// what the render reaches for. The difference is that a host call can be stubbed
// into a promise that never resolves, so its boundary becomes a hole — and there
// is nothing to hang on a synchronous `new Date()`. So this can report, and
// cannot repair.

import { AsyncLocalStorage } from 'node:async_hooks'

/** Which route is rendering, so a call can be attributed under concurrency. */
const rendering = new AsyncLocalStorage<Set<string>>()

/** What each of the watched globals is called, for the message. */
const WATCHED = ['new Date()', 'Date.now()', 'Math.random()', 'crypto.randomUUID()'] as const

let installed = 0
let restore: (() => void) | null = null

/**
 * Watch the non-deterministic globals for the duration of a prerender.
 *
 * Patched once around the whole run rather than per route, because the routes
 * render concurrently and a global cannot be swapped per render. Attribution
 * comes from the async context instead, which is exact: React's own render does
 * not call any of these, so a recorded call came from application code.
 */
export function watchNondeterminism(): () => void {
  if (installed++ === 0) {
    const realDate = globalThis.Date
    const realRandom = Math.random
    const realUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)

    const note = (what: string) => {
      rendering.getStore()?.add(what)
    }

    // A subclass rather than a Proxy: `new Date()` has to keep working, and
    // instanceof has to keep answering true for anything the app does with it.
    class WatchedDate extends realDate {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(...args: any[]) {
        // Only a no-argument call reads the clock. `new Date('2020-01-01')` is
        // as deterministic as a string literal.
        if (args.length === 0) note('new Date()')

        // @ts-expect-error - forwarding Date's overloads verbatim
        super(...args)
      }

      static now(): number {
        note('Date.now()')

        return realDate.now()
      }
    }

    globalThis.Date = WatchedDate as DateConstructor

    Math.random = function random(): number {
      note('Math.random()')

      return realRandom.call(Math)
    }

    if (realUUID && globalThis.crypto) {
      globalThis.crypto.randomUUID = function randomUUID() {
        note('crypto.randomUUID()')

        return realUUID()
      } as Crypto['randomUUID']
    }

    restore = () => {
      globalThis.Date = realDate
      Math.random = realRandom

      if (realUUID && globalThis.crypto) globalThis.crypto.randomUUID = realUUID
    }
  }

  return () => {
    if (--installed === 0) {
      restore?.()
      restore = null
    }
  }
}

/** Run a route's render, collecting what it reached for. */
export function whileRendering<T>(run: () => Promise<T>): Promise<[T, string[]]> {
  const found = new Set<string>()

  return rendering.run(found, run).then((value) => [value, [...found]])
}

export { WATCHED }
