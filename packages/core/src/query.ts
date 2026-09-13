// Reads from the server, over GET, without an endpoint to write.
//
//     // listings.ts
//     "use server"
//     import { query } from '@rsc-kit/core/query'
//
//     export const getListings = query(async (filters: Filters) =>
//       listingService.getFiltered(filters))
//
// A server function is a POST, and a POST is cacheable by nothing: not an HTTP
// cache, not a CDN, not the service worker this package generates. Routing
// reads through one makes every dynamic read the single thing that cannot
// survive without a network. That is the whole reason this exists alongside
// actions rather than on top of them.
//
// The module still carries "use server", because that is what registers the
// function and gives it an id — this does not invent a second registry. What
// it adds is a mark saying the function is a READ, which the GET endpoint
// checks before invoking anything. Without that check, `/_rsc/query?id=…`
// would run any registered action over GET, which is the classic
// a-crawler-emptied-the-database bug.

/**
 * Marks a function as safe to invoke over GET.
 *
 * A property rather than a WeakSet or `instanceof`, for the reason this
 * project keeps meeting: an app's server functions are bundled separately from
 * the engine, so each side gets its own copy of this module. Anything holding
 * identity across that seam — a set, a class — is simply empty on the other
 * side, and every query would answer "not a query" with nothing logged.
 *
 * Symbol.for, so both copies agree on the key as well as the value.
 */
const QUERY_MARK = Symbol.for('@rsc-kit/core.query')
const QUERY_OPTIONS = Symbol.for('@rsc-kit/core.query-options')

/** How the answer may be stored. Conservative by default — see `QueryOptions`. */
export interface QueryOptions {
  /**
   * What `Cache-Control` the answer carries.
   *
   * The default is `private, no-store`, and it is deliberately the safe one: a
   * query may read the session, and a cacheable answer to a personal read is
   * how one visitor is served another's data. Widen it per query, once you
   * have looked at what that query returns.
   *
   * `'private'` lets the visitor's own browser and service worker keep it and
   * nothing else. `'public'` lets a CDN keep it, and is only ever right for a
   * read whose answer does not depend on who is asking.
   */
  cache?: 'no-store' | 'private' | 'public'
  /** Seconds the answer stays fresh. Ignored when `cache` is `'no-store'`. */
  maxAge?: number
}

/** A function that may be read over GET. */
export type QueryFn<Args extends unknown[], Data> = (...args: Args) => Promise<Data>

/**
 * Declare a read.
 *
 * The wrapper is what gets registered and what the id points at, so the mark
 * travels with the thing the endpoint actually loads. Wrapping rather than
 * annotating the original also keeps `query(fn)` honest when someone exports
 * the raw `fn` beside it: that export is an action, not a query, and the GET
 * endpoint will refuse it.
 */
export function query<Args extends unknown[], Data>(
  fn: (...args: Args) => Promise<Data> | Data,
  options: QueryOptions = {},
): QueryFn<Args, Data> {
  const read = async (...args: Args): Promise<Data> => await fn(...args)

  // Non-enumerable, so the mark does not show up in anything that walks the
  // function's own keys — a bundler's export analysis, a test's snapshot.
  Object.defineProperty(read, QUERY_MARK, { value: true })
  Object.defineProperty(read, QUERY_OPTIONS, { value: options })

  return read as QueryFn<Args, Data>
}

/** Whether this function was declared with `query()`, whichever copy declared it. */
export function isQuery(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as unknown as Record<symbol, unknown>)[QUERY_MARK] === true
}

/** What the query asked for, or the safe default when it asked for nothing. */
export function queryOptions(fn: unknown): QueryOptions {
  if (typeof fn !== 'function') return {}

  return ((fn as unknown as Record<symbol, unknown>)[QUERY_OPTIONS] as QueryOptions) ?? {}
}

/** The `Cache-Control` a query's answer goes out with. */
export function queryCacheControl(fn: unknown): string {
  const { cache = 'no-store', maxAge } = queryOptions(fn)

  if (cache === 'no-store') return 'private, no-store'

  const age = typeof maxAge === 'number' && maxAge > 0 ? Math.floor(maxAge) : 0

  // must-revalidate at zero rather than omitting max-age: with no directive at
  // all, whether an intermediary keeps it comes down to that intermediary's
  // heuristics, and this package does not leave that to chance in either
  // direction.
  return age > 0 ? `${cache}, max-age=${age}` : `${cache}, max-age=0, must-revalidate`
}
