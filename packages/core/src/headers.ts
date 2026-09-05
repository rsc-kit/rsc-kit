// The wire protocol, as names rather than string literals.
//
// A host writing these out by hand is how they drift. Two of them are not
// negotiable at all — the client sends them or asks for them at fixed
// addresses, and a host that spells one differently fails silently: the
// request falls through, the decoder never runs, and a button does nothing
// with no error on either side.
//
// PROTOCOL.md describes what each one means. This is the same list, importable.

export const HEADER = {
  /**
   * Present on a request for a Flight payload rather than the document. One
   * url serves both, which is why every answer must Vary on it.
   */
  rsc: 'X-RSC',

  /** The layout chain the client has mounted, outermost first, comma-separated. */
  segments: 'X-RSC-Segments',

  /** The boundary the answer replaces. 0 means a whole document. */
  segmentDepth: 'X-RSC-Segment-Depth',

  /** The chain to send back next time. */
  layouts: 'X-RSC-Layouts',

  /** Identifies the build, so a client can notice it is talking to an old one. */
  version: 'X-RSC-Version',

  /** The slot an intercepted navigation is targeting. */
  intercept: 'X-RSC-Intercept',

  /** Where the navigation or action came from. */
  referer: 'X-RSC-Referer',

  /** One named region of the current page to render and return alone. */
  revalidate: 'X-RSC-Revalidate',

  /** The server reference being invoked. */
  action: 'X-RSC-Action',

  /**
   * Go here instead.
   *
   * Used for a redirect the client has to perform itself: a failed action, and
   * a navigation whose render redirected. Never a 3xx for those — `fetch`
   * follows one transparently, so the client would get the destination's HTML
   * where it expected a Flight payload and decode it as one.
   */
  redirect: 'X-RSC-Redirect',

  /**
   * The body's real type.
   *
   * The body itself goes out as application/octet-stream so a host that parses
   * multipart cannot consume it before the action does — reading Content-Type
   * instead leaves an upload undecodable.
   */
  contentType: 'X-RSC-Content-Type',

  /**
   * Where the browser posts server actions.
   *
   * Not a convention this can choose: the client runtime posts here
   * unconditionally.
   */
  actionPath: '/_rsc/action',
} as const

/** Flight payload. */
export const FLIGHT_TYPE = 'text/x-component; charset=utf-8'

/** A rendered document. */
export const HTML_TYPE = 'text/html; charset=utf-8'

/**
 * Every request header that changes what a response body contains.
 *
 * One url answers with a whole document, a partial payload, a named region or
 * an interceptor depending on these — so a cache keyed on the url alone, or on
 * `X-RSC` alone, will hand one client another's answer. They are materially
 * different bodies, not variations in presentation.
 */
export const VARY_ON_RSC = [
  HEADER.rsc,
  HEADER.segments,
  HEADER.revalidate,
  HEADER.intercept,
  HEADER.referer,
].join(', ')
