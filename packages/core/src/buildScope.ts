// rpc() during a build.
//
// A page whose data is the same for everyone can be stored, and for an app
// with a backend that data is behind rpc(). So the build asks: each call is
// answered by the backend's own process (buildProcess.ts), and the answer is
// part of the page. A call that read the visitor - the session, a cookie, who
// is signed in - has no answer a build could store, and the backend says so;
// that call suspends, exactly as connection() would, and the page streams
// there.
//
// Two copies of this module exist during a build: the plugin's, which starts
// the backend and times each render, and the one inside the bundle, where
// rpc() is. What they share is on the global, under keys both copies agree on.

import { AsyncLocalStorage } from 'node:async_hooks'
import { interpretReply, type HostCallReply } from './hostCalls.js'

/** What the backend said: an answer, or what of a visitor the call read. */
export type BuildAnswer =
  | { visitor: string[] }
  | { status: number; reply: HostCallReply | null; text: string }

/** Whatever answers a build's calls. */
export interface BuildAnswerer {
  ask(name: string, args: unknown[]): Promise<BuildAnswer>
}

/** What one route's renders called, and how many answers they are waiting for. */
interface Scope {
  pending: number
  listeners: Set<() => void>
  /** Answered, and in what the build stored. */
  answered: Set<string>
  /** Needs a visitor: the call, and what it read. */
  visitors: Map<string, string[]>
  /** Calls the backend failed, with its message. */
  failed: Map<string, string>
}

export interface BuildCallsMade {
  answered: string[]
  /** Each already says what it read: `rpc("Cart.items") (the session)`. */
  visitors: string[]
  failed: string[]
}

const ANSWERER = Symbol.for('rsc-kit.build-answerer')
const SCOPES = Symbol.for('rsc-kit.build-scope')

const shared = globalThis as Record<symbol, unknown>

function scopes(): AsyncLocalStorage<Scope> {
  return (shared[SCOPES] ??= new AsyncLocalStorage<Scope>()) as AsyncLocalStorage<Scope>
}

/** Whether this build has a backend to ask. */
export function buildAnswerer(): BuildAnswerer | null {
  return (shared[ANSWERER] as BuildAnswerer | undefined) ?? null
}

/** Have rpc() answered by this, until what is returned is called. */
export function installBuildAnswerer(answerer: BuildAnswerer): () => void {
  shared[ANSWERER] = answerer

  return () => {
    if (shared[ANSWERER] === answerer) delete shared[ANSWERER]
  }
}

/** The call as the build writes it, with what it read when that is why. */
export function saidCall(name: string, read: string[] = []): string {
  return 'rpc(' + JSON.stringify(name) + ')' + (read.length ? ' (' + read.join(', ') + ')' : '')
}

/**
 * Run one route's renders, noting the calls they make.
 *
 * The notes are read while the render may still be going - a render with a
 * hole never ends - so they are handed over as a function.
 */
export function withBuildCalls<T>(run: (made: () => BuildCallsMade) => Promise<T>): Promise<T> {
  const scope: Scope = { pending: 0, listeners: new Set(), answered: new Set(), visitors: new Map(), failed: new Map() }

  return scopes().run(scope, () =>
    run(() => ({
      answered: [...scope.answered].map((name) => saidCall(name)),
      visitors: [...scope.visitors].map(([name, read]) => saidCall(name, read)),
      failed: [...scope.failed].map(([name, message]) => saidCall(name) + ' failed: ' + message),
    })),
  )
}

/**
 * Answer one rpc() of a build.
 *
 * `needsVisitor` decides what a call that read the visitor does to the render
 * that made it: suspend, for the probe deciding what a page's shell is.
 * Outside any route - generateStaticParams, register() - there is no render
 * to leave a hole in, so it is an error that says what was read.
 */
export async function answerAtBuild(
  args: unknown[],
  needsVisitor?: (said: string) => Promise<unknown>,
): Promise<unknown> {
  const answerer = buildAnswerer()
  const name = String(args[0])

  if (!answerer) throw new Error(saidCall(name) + ' cannot be answered: this build has no backend to ask.')

  const scope = scopes().getStore()
  const changed = () => {
    for (const listener of [...(scope?.listeners ?? [])]) listener()
  }

  if (scope) {
    scope.pending++
    changed()
  }

  let answer: BuildAnswer

  try {
    answer = await answerer.ask(name, args.slice(1))
  } catch (error) {
    scope?.failed.set(name, error instanceof Error ? error.message : String(error))

    throw error
  } finally {
    if (scope) {
      scope.pending--
      changed()
    }
  }

  const read = visitorRead(answer)

  if (read) {
    scope?.visitors.set(name, read)

    if (needsVisitor) return needsVisitor(saidCall(name, read))
    // In a render whose probe said nothing: an api route, whose budget turns
    // waiting into "dynamic".
    if (scope) return new Promise(() => {})

    throw new Error(
      saidCall(name) + ' reads ' + read.join(', ') + ', and a build has no visitor. ' +
        'Nothing is being rendered here that could wait for one.',
    )
  }

  const settled = answer as Exclude<BuildAnswer, { visitor: string[] }>

  if (settled.reply?.error !== undefined && settled.reply.refusalStatus === undefined) {
    scope?.failed.set(name, settled.reply.error)
  } else {
    scope?.answered.add(name)
  }

  // What it revalidated is nothing: there is no page in a browser to refresh.
  return interpretReply(name, settled, () => {})
}

/**
 * What of a visitor an answer says it read. A refusal to someone not signed
 * in is one too: the build is not, and the visitor may be.
 */
export function visitorRead(answer: BuildAnswer): string[] | null {
  if ('visitor' in answer) return answer.visitor.length ? answer.visitor : ['the visitor']
  if (answer.reply?.unauthenticated || answer.status === 401) return ['who is signed in']
  if (answer.reply?.unauthorized || answer.status === 403) return ['what they may do']

  return null
}

/**
 * A render's budget, not counting the time it spends waiting for the backend.
 *
 * The budget asks what a page cannot finish at build time, and a call being
 * answered is not that: without this a query slower than two seconds - or
 * just behind others in the queue - turned a page that could be stored into
 * one that streams, depending on how busy the build machine was.
 */
export function buildBudget(ms: number, expire: () => void): { stop(): void } {
  const scope = scopes().getStore()
  let timer: ReturnType<typeof setTimeout> | undefined
  let left = ms
  let since = 0

  const pause = () => {
    if (timer === undefined) return

    clearTimeout(timer)
    timer = undefined
    // What an answer unblocked still has to render.
    left = Math.max(left - (performance.now() - since), Math.min(ms, 100))
  }

  const update = () => {
    if (scope?.pending) {
      pause()
    } else if (timer === undefined) {
      since = performance.now()
      timer = setTimeout(expire, left)
    }
  }

  scope?.listeners.add(update)
  update()

  return {
    stop() {
      scope?.listeners.delete(update)
      pause()
    },
  }
}

/** Whether the route being rendered is waiting for the backend. */
export function awaitingBuildAnswer(): boolean {
  return (scopes().getStore()?.pending ?? 0) > 0
}

/** Told whenever that may have changed, until the function returned is called. */
export function onBuildAnswer(listener: () => void): () => void {
  const scope = scopes().getStore()

  scope?.listeners.add(listener)

  return () => scope?.listeners.delete(listener)
}
