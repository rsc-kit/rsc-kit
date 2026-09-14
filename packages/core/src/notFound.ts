// Saying a url does not name a page, from inside a render.
//
//   import { notFound } from '@rsc-kit/core/not-found'
//
//   export default async function PostPage({ params }) {
//     const post = await findPost((await params).slug)
//     if (!post) notFound()
//     ...
//   }
//
// Until this existed, "no such page" could only be decided by the router,
// before anything rendered. But most of the time it is not knowable then: the
// route matched, the url is well-formed, and whether the thing exists is a
// question only the page can ask. The alternative was an error boundary and a
// 500, which tells a crawler the page is broken rather than absent.
//
// Delivery follows the same two windows a redirect has, and for the same
// reason — headers flush when the shell resolves:
//
//   Before the shell — nothing is written yet, so the host answers 404 and
//   renders not-found.tsx. This is where a params check lands, and where a
//   lookup at the top of a page lands.
//
//   After the shell — the status line is gone. React carries an error digest
//   for every server error, so the mark travels there and the boundary around
//   it shows its fallback rather than a stack.

/**
 * The mark that says an error is a missing page.
 *
 * A property rather than `instanceof`, for the reason this project keeps
 * meeting: the app's components are bundled apart from the engine that renders
 * them, so each side evaluates its own copy of this module and its own copy of
 * the class. `instanceof` is simply false across that seam — the page would
 * render as an unhandled error, and the only clue would be a 500 where a 404
 * was meant.
 */
const MARK = Symbol.for('@rsc-kit/core.not-found-signal')

/**
 * Where a render records that it wants the not-found page.
 *
 * The same scope a redirect records in, reached through the well-known symbol
 * rather than by importing it: this module is evaluated in the app bundle, the
 * engine and the browser, and only one of those should be pulling in the
 * redirect machinery.
 *
 * Recording is necessary because the throw alone does not survive. React
 * catches what a component threw and re-raises its own error, whose message is
 * stripped in production — so the host testing the caught value would work in
 * development and answer 500 in production, which is the worst of the two
 * possible bugs.
 */
const SCOPE = Symbol.for('@rsc-kit/core.redirect-scope')

function record(): void {
  const scope = (globalThis as Record<symbol, unknown>)[SCOPE] as
    | { getStore(): { notFound?: boolean } | undefined }
    | undefined

  const store = scope?.getStore()

  if (store) store.notFound = true
}

/** Thrown to stop rendering a page whose subject does not exist. */
export class NotFoundSignal extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundSignal'
    ;(this as unknown as Record<symbol, boolean>)[MARK] = true

    // In the constructor rather than in notFound(), so every way of raising
    // one is recorded — a params schema refusing is not routed through the
    // public function and must answer the same way.
    record()
  }
}

/** Whether this is a missing page, whichever copy of the class threw it. */
export function isNotFoundSignal(error: unknown): error is NotFoundSignal {
  return (
    typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[MARK] === true
  )
}

/**
 * The prefix that carries a missing page inside React's error digest.
 *
 * React replaces a server error's message with an opaque digest in production,
 * and the digest is the one part it is guaranteed to transmit. Kept distinct
 * from the redirect prefix so neither is ever read as the other.
 */
const PREFIX = 'RSC_NOT_FOUND'

/** The digest for a missing page, or null for any other error. */
export function notFoundDigest(error: unknown): string | null {
  return isNotFoundSignal(error) ? PREFIX : null
}

/** Whether a digest describes a missing page. */
export function isNotFoundDigest(digest: unknown): boolean {
  return digest === PREFIX
}

/**
 * Answer this url with the not-found page.
 *
 * Never returns: it throws, which stops the component that called it. Do not
 * wrap a call in `try`/`catch` without rethrowing what you do not recognise —
 * swallowing this turns a missing page into a blank region.
 *
 * Called above every Suspense boundary, the response is a real 404 carrying
 * not-found.tsx, which is what a crawler and a cache need to see. Called
 * inside one, the shell is already on the wire, so the boundary shows its
 * fallback instead and the status stays 200 — put the lookup above the
 * boundary when the status matters.
 */
export function notFound(): never {
  throw new NotFoundSignal()
}
