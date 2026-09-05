// Asking the same question twice in one request.
//
//   import { cache } from '@rsc-router/core/cache'
//
//   export const currentUser = cache(async () => db.user(await sessionId()))
//
// A guard checks who you are; the layout wants their name; the page wants their
// permissions. Three calls, one request, one answer — without threading the
// result through props that only exist to carry it.
//
// This is the same shape as React's cache(), and deliberately not React's: the
// engine's own boundaries are not React's. A guard runs before any component
// does, which is exactly where the duplication starts, and React has no scope
// open there.
//
// Scoped to the request, so two in flight cannot see each other's answers. The
// scope is opened by whoever owns the request — the host, the worker, or the
// prerenderer — and everything below it shares one store.

import { resolveScope } from './revalidate.js'

/** One request's memo table. */
type Store = Map<unknown, ArgNode>

/**
 * Arguments keyed the way React keys them: a tree, one level per argument.
 *
 * Primitives compare by value and objects by identity, which falls out of
 * using a Map for the first and a WeakMap for the second. Serialising the
 * arguments instead would make `f({ a: 1 })` and `f({ a: 1 })` the same call —
 * which they are not, if the object is mutable.
 */
interface ArgNode {
  /** The answer for the argument list that ends here. */
  result?: { value: unknown }
  byValue?: Map<unknown, ArgNode>
  byIdentity?: WeakMap<object, ArgNode>
}

const SCOPE = Symbol.for('@rsc-router/core.cache-scope')

const globals = globalThis as Record<symbol | string, unknown>

let ready: Promise<void> | null = null

interface Scope {
  getStore(): Store | undefined
  run<T>(store: Store, fn: () => T): T
}

function scope(): Scope | null {
  return (globals[SCOPE] as Scope | undefined) ?? null
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

/** Walk to the node for this argument list, creating it as we go. */
function nodeFor(root: ArgNode, args: unknown[]): ArgNode {
  let node = root

  for (const arg of args) {
    if (isObject(arg)) {
      node.byIdentity ??= new WeakMap()

      let next = node.byIdentity.get(arg)

      if (!next) {
        next = {}
        node.byIdentity.set(arg, next)
      }

      node = next
    } else {
      node.byValue ??= new Map()

      let next = node.byValue.get(arg)

      if (!next) {
        next = {}
        node.byValue.set(arg, next)
      }

      node = next
    }
  }

  return node
}

/**
 * Memoise a function for the length of one request.
 *
 * The *promise* is cached, not the value, so callers that arrive while the
 * first is still in flight wait on it rather than starting a second. A
 * rejection is cached too: within one request the answer to a question does
 * not change because you asked again.
 *
 * Outside a request this calls straight through. Nothing is stored, nothing
 * leaks between requests, and shared code does not have to know which side of
 * the boundary it is on — the same reason revalidate() is a no-op outside an
 * action.
 */
export function cache<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => {
    const store = scope()?.getStore()

    if (!store) return fn(...args)

    let root = store.get(fn)

    if (!root) {
      root = {}
      store.set(fn, root)
    }

    const node = nodeFor(root, args)

    if (node.result) return node.result.value as R

    const value = fn(...args)

    node.result = { value }

    return value
  }
}

/** Whether anything is listening, for code that wants to know. */
export function isCaching(): boolean {
  return scope()?.getStore() !== undefined
}

/**
 * Run one request with a memo table of its own.
 *
 * Opened by whoever owns the request. Nesting is harmless and does not create a
 * second table — an inner call reuses the one already open, so a host that
 * wraps and an engine that also wraps do not end up with two.
 */
export async function withCache<T>(run: () => Promise<T>): Promise<T> {
  if (!globals[SCOPE]) {
    ready ??= resolveScope().then((resolved) => {
      globals[SCOPE] ??= resolved as unknown as Scope
    })

    await ready
  }

  const existing = scope()!.getStore()

  if (existing) return await run()

  return await scope()!.run(new Map(), run)
}
