// Redirecting from inside a render.
//
//   import { redirect } from '@rsc-router/core/redirect'
//
//   export default async function ProductPage({ slug }) {
//     const product = await findProduct(slug)
//     if (!product) redirect('/products')
//     ...
//   }
//
// The hard part is not throwing — it is that a redirect decided during a
// render may be decided after the response has already begun. Headers flush
// early on purpose (see the stream-start invariant), so by the time a
// component deep in a Suspense boundary changes its mind, the 200 is gone.
//
// So there are two windows, and which one a redirect lands in is decided by
// where it was thrown rather than by anything the caller does:
//
//   Before the shell resolves — nothing has been written. The host answers
//   with a real 3xx, or for a navigation with X-RSC-Redirect, and the browser
//   never sees the page. This is the window every guard lands in, because a
//   guard runs above the boundaries.
//
//   After the shell resolves — the shell is already on the wire. It holds
//   layouts and Suspense fallbacks, so no data from the redirecting subtree
//   has been shown. The location travels to the client instead, which
//   performs it as an ordinary SPA navigation.
//
// Neither window costs a buffered byte. The first exists because the host
// already awaits the shell before writing anything; the second because React
// already carries an error digest to the client.

import type { Href } from './routes.js'
import { resolveScope } from './revalidate.js'
import { RedirectSignal } from './redirectDigest.js'
import type { Redirection } from './redirectDigest.js'

export { RedirectSignal, isRedirectSignal, redirectDigest, parseRedirectDigest } from './redirectDigest.js'
export type { Redirection } from './redirectDigest.js'

/** Per-render state, for the same reason revalidation has it: two can be in flight. */
interface Slot {
  redirect: Redirection | null
}

interface Scope {
  getStore(): Slot | undefined
  run<T>(store: Slot, fn: () => T): T
}

/**
 * One scope, however many copies of this module exist.
 *
 * The app's components are bundled into the server bundle and the host is
 * not, so this module is loaded twice. Two scopes would mean the component
 * records in one and the host reads the other: the redirect is simply never
 * honoured, and nothing on either side reports a problem.
 */
const SCOPE = Symbol.for('@rsc-router/core.redirect-scope')

const globals = globalThis as Record<symbol | string, unknown>

let ready: Promise<void> | null = null

function scope(): Scope | null {
  return (globals[SCOPE] as Scope | undefined) ?? null
}

/**
 * Leave this page for another one.
 *
 * Never returns: it throws, which stops the component that called it. Do not
 * wrap a call in `try`/`catch` without rethrowing what you do not recognise —
 * swallowing this turns a redirect into a blank region.
 *
 * `location` is typed to the routes the build found, so a redirect to a page
 * that no longer exists stops compiling. Cast with `as Href` when the
 * destination is computed — remembering where someone was going and sending
 * them back to it is the usual case.
 *
 * Where it is called decides how it is delivered, and the difference matters
 * for anything that must not be seen. A call above every Suspense boundary is
 * answered with a status code before a byte is written. A call inside one is
 * answered after the shell — which holds no data from inside the boundary,
 * but does hold whatever the layouts above it rendered.
 */
export function redirect(location: Href, status = 307): never {
  const store = scope()?.getStore()

  // First wins. A layout that redirects and a page that also redirects should
  // land where the outer one said, not wherever finished last.
  if (store && !store.redirect) {
    store.redirect = { location, status }
  }

  throw new RedirectSignal(location, status)
}

/** The redirect asked for during the current render, if any. */
export function currentRedirect(): Redirection | null {
  return scope()?.getStore()?.redirect ?? null
}

/**
 * Run a render with somewhere for a redirect to be recorded, and report one.
 *
 * `taken()` is read twice by a streaming host: once when the shell resolves,
 * to answer with a status code, and again when the stream ends, for a
 * redirect that arrived too late for one.
 */
export async function withRedirect<T>(
  run: (taken: () => Redirection | null) => Promise<T>,
): Promise<T> {
  if (!globals[SCOPE]) {
    ready ??= resolveScope().then((resolved) => {
      globals[SCOPE] ??= resolved as unknown as Scope
    })

    await ready
  }

  const slot: Slot = { redirect: null }

  return await scope()!.run(slot, () => run(() => slot.redirect))
}
