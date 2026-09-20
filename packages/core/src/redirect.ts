// Redirecting from inside a render.
//
//   import { redirect } from '@rsc-kit/core/redirect'
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

import { assertSafeRedirect } from './safeUrl.js'
import { withSearch } from './routes.js'
import type { Href, Route, SearchFor } from './routes.js'
import { resolveScope } from './revalidate.js'
import { RedirectSignal } from './redirectDigest.js'
import type { Redirection } from './redirectDigest.js'

export { RedirectSignal, isRedirectSignal, redirectDigest, parseRedirectDigest } from './redirectDigest.js'
export type { Redirection } from './redirectDigest.js'

/** Per-render state, for the same reason revalidation has it: two can be in flight. */
interface Slot {
  redirect: Redirection | null
  /**
   * Whether the render asked for the not-found page.
   *
   * Shares this scope rather than opening a second one, because it is the same
   * question asked once per render — "did this page decide to answer as
   * something other than itself" — and every render path is already wrapped in
   * this one. notFound.ts sets it through the scope symbol without importing
   * this module; see the note there.
   */
  notFound?: boolean
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
const SCOPE = Symbol.for('@rsc-kit/core.redirect-scope')

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
/**
 * What a redirect may carry beside its destination. `search` is typed to the
 * destination page's own `searchParams` schema when it exports one - the
 * same check `Link` puts on its `search` prop - so a key the page never
 * reads, or a number written as text, does not compile.
 */
export type RedirectOptions<H extends Href> = ({} extends SearchFor<H>
  ? { search?: SearchFor<H> }
  : { search: SearchFor<H> }) & {
  /** 307 unless said otherwise; 308 for a permanent one. */
  status?: number
}

export function redirect<H extends Route>(
  location: H,
  ...rest: {} extends SearchFor<H> ? [options?: RedirectOptions<H> | number] : [options: RedirectOptions<H>]
): never {
  // The second argument was a status alone once; it still is, and an object
  // carries the query string beside it.
  const options = typeof rest[0] === 'number' ? { status: rest[0] } : (rest[0] ?? {})
  const status = options.status ?? 307
  const search = (options as { search?: object }).search

  return redirectTo(search ? (withSearch(location, search) as Href) : location, status)
}

function redirectTo(location: Href, status: number): never {
  // Refused here, at the one place every delivery path leads back to. The
  // destination reaches location.href on the client and an inline script in a
  // document, and a javascript: url runs in all of them.
  assertSafeRedirect(location)

  // A redirect is a 3xx. Anything else produces a response carrying Location
  // that no browser acts on — the page renders, the redirect silently does not
  // happen, and nothing says why.
  if (status < 300 || status > 399) {
    throw new Error(
      'Not a redirect status: ' + status + '. A redirect is 3xx; 307 preserves the method.',
    )
  }

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
 * Whether the current render called notFound().
 *
 * Read rather than caught, for the reason the redirect above is: React
 * re-raises a component's error as its own, so the thrown signal does not
 * arrive intact at the host in production.
 */
export function currentNotFound(): boolean {
  return scope()?.getStore()?.notFound === true
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

  const slot: Slot = { redirect: null, notFound: false }

  return await scope()!.run(slot, () => run(() => slot.redirect))
}
