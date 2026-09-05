// What a redirect is, and how it survives every boundary it has to cross.
//
// Its own module because three graphs need it and none of them can import the
// others' halves: the app bundle (where a component calls redirect()), the
// engine (which turns it into a digest), and the browser (which performs it).
// Nothing here imports anything, so all three can have it.

export interface Redirection {
  location: string
  /**
   * 307 by default rather than 302: it preserves the method, so a redirect out
   * of a POST does not silently become a GET of the target.
   */
  status: number
}

/**
 * The mark that says an error is a redirect.
 *
 * A property rather than `instanceof`, for the reason this project keeps
 * running into: the app's components are bundled separately from the engine
 * that renders them, so each gets its own copy of this module and its own copy
 * of the class. `instanceof` compares identity across that seam and is simply
 * false — the redirect renders as an unhandled error, and the only clue is
 * that the page went blank instead of moving.
 *
 * Symbol.for, so the two copies agree on the key as well as the value.
 */
const MARK = Symbol.for('@rsc-kit/core.redirect-signal')

/** Thrown to stop rendering the subtree that redirected. */
export class RedirectSignal extends Error {
  public readonly location: string
  public readonly status: number

  constructor(location: string, status: number) {
    super(`Redirect to ${location}`)
    this.name = 'RedirectSignal'
    this.location = location
    this.status = status
    ;(this as unknown as Record<symbol, boolean>)[MARK] = true
  }
}

export function isRedirectSignal(error: unknown): error is RedirectSignal {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<symbol, unknown>)[MARK] === true
  )
}

/**
 * The prefix that carries a redirect inside React's error digest.
 *
 * React replaces a server error's message with an opaque digest in production,
 * and the digest is the one part it is guaranteed to transmit. A redirect
 * decided after the shell has no header left to travel in — the status line is
 * already sent — so it travels here.
 */
const PREFIX = 'RSC_REDIRECT;'

/** The digest for a redirect, or null for any other error. */
export function redirectDigest(error: unknown): string | null {
  if (!isRedirectSignal(error)) return null

  return `${PREFIX}${error.status};${error.location}`
}

/** The redirect a digest describes, or null if it describes something else. */
export function parseRedirectDigest(digest: unknown): Redirection | null {
  if (typeof digest !== 'string' || !digest.startsWith(PREFIX)) return null

  const rest = digest.slice(PREFIX.length)
  const separator = rest.indexOf(';')

  if (separator === -1) return null

  const status = Number(rest.slice(0, separator))
  const location = rest.slice(separator + 1)

  if (!location) return null

  return { location, status: Number.isFinite(status) ? status : 307 }
}
