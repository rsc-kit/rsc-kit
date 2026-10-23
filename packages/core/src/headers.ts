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

  /**
   * On a payload request: this url's page said it does not exist, after the
   * shell went out, and the client is asking for the not-found page to put
   * where it was. RedirectBoundary sends it.
   */
  notFound: 'X-RSC-Not-Found',

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
  /**
   * Where the browser reads queries.
   *
   * A GET, and that is the whole point of it being a separate address: a POST
   * is cacheable by nothing, so a read routed through the action endpoint can
   * never be kept by an HTTP cache, a CDN or a service worker. Only functions
   * declared with `query()` are reachable here — the endpoint checks the mark
   * before invoking anything, because otherwise this address would run any
   * registered action over GET.
   */
  /**
   * Sent on every read, and required by the query endpoint.
   *
   * A GET with no unusual header is a simple request, so any page could
   * trigger one with an <img> and the visitor's cookies would ride along.
   * This header is not CORS-safelisted, so the browser preflights it — the
   * same thing that makes a POST carrying X-RSC-Action safe.
   */
  query: 'X-RSC-Query',

  queryPath: '/_rsc/query',
  /**
   * On a refresh a change triggered: which names moved, to which versions
   * (`stock@5,orders@2`). A shared section renders once per such change, and
   * every tab asking with the same one gets that render.
   */
  changedBy: 'X-RSC-Changed',
  /** The stream a tab hears on when a name its page refreshes on has changed. */
  changesPath: '/_rsc/changes',
  /** Whether this renderer can serve: up, and its backend answering. GET only, never cached. */
  healthPath: '/_rsc/health',
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

/**
 * What a response says about being stored, when it must not be.
 *
 * `Vary` alone is not enough on the platform this targets. Cloudflare ignores
 * `Vary` for everything except `Accept-Encoding`, and this package ships a
 * Workers story as a headline feature — so one url answering with a document,
 * a Flight payload, a segment and an interceptor, keyed only on the url, hands
 * one visitor another's body. Anything narrowed by a request header, and
 * anything behind a guard, says outright that it is not to be stored.
 */
export const PER_CLIENT = 'private, no-store'

/**
 * And what a frozen, unguarded page says.
 *
 * Explicit rather than absent: with no directive at all, whether an
 * intermediary stores it comes down to that intermediary's heuristics, which
 * is not a decision this package should be leaving to chance in either
 * direction.
 */
export const REVALIDATE = 'public, max-age=0, must-revalidate'

/**
 * And what a page rendered for one request says.
 *
 * It may have read the visitor's cookies, and nothing in the headers - which
 * leave before the render has finished - can know whether it did. So a shared
 * cache may not keep it; the visitor's own browser may, and must ask again.
 */
export const PER_REQUEST = 'private, max-age=0, must-revalidate'

/**
 * The edge contract: one marker, one page endpoint, one resume, for any edge
 * and any framework that implements it. Vendor-neutral names on purpose: an
 * edge speaks the contract, and there is no second way in that is rsc-kit's
 * own. docs/reference/edge-contract.mdx is the specification.
 */
export const EDGE = {
  prefix: '/_edge/',
  pagePath: '/_edge/page',
  resumePath: '/_edge/resume',
  tokenEnv: 'EDGE_TOKEN',
  token: 'Edge-Token',
  build: 'Edge-Build',
  /** The marker's copy beside the stored pages, which the host reads. */
  storedMarker: '_edge.json',
} as const

/**
 * The response headers an edge may send with a page it serves from its cache
 * (the contract's `headers`), and so the only ones rscKit({ headers }) sets:
 * one outside this list could not leave with a cached page, and the page would
 * go out without it.
 */
export const EDGE_HEADERS = [
  'Content-Language',
  'Link',
  'Cache-Control',
  'X-Robots-Tag',
  'Content-Security-Policy',
  'Permissions-Policy',
  'Referrer-Policy',
  'Strict-Transport-Security',
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Cross-Origin-Opener-Policy',
  'Cross-Origin-Embedder-Policy',
  'Cross-Origin-Resource-Policy',
  'X-DNS-Prefetch-Control',
] as const
