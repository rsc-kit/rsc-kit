// Matching a url to a route, and deciding how much of the page to send.
//
// Pure: no Request, no Response, no filesystem. That is what lets the same
// implementation serve three callers — the request handler, the prerenderer
// enumerating what to build, and the generated server bundle, which embeds its
// own route table and answers these without a manifest being passed around at
// all.
//
// Every host would otherwise write this, and would get the same two things
// wrong: answering /docs/new with [slug], and treating the layout chain as a
// set rather than a sequence.

import type { ManifestApiRoute, ManifestRoute, RouteManifest, RouteSegment } from './manifest.js'

/** A matched route and the params its url segments bound. */
export interface MatchedRoute {
  route: ManifestRoute
  params: Record<string, string>
}

/**
 * Match a pathname against the manifest's segments.
 *
 * The manifest stores segments rather than a pattern string, because the
 * pattern is the host's dialect — Laravel writes `{slug}`, Hono writes
 * `:slug`, and neither is the build's business. Matching them directly means
 * no dialect at all.
 *
 * Static segments beat dynamic ones at the same position: /docs/new is the
 * page called new, not the page called [slug] with slug=new.
 */
/** A `route.ts` the url matched, and the params it bound. */
export interface MatchedApiRoute {
  route: ManifestApiRoute
  params: Record<string, string>
}

/**
 * The api route a url answers, if one does.
 *
 * Exact segment binding only, scored the same way pages are: more static
 * segments wins, a catch-all is weakest. Reusing that is the point — an api
 * route takes `[id]` and `[...rest]` because the matcher was already there.
 */
/**
 * A manifest's routes, indexed once.
 *
 * Every request used to score every route with a reduce over its segments,
 * which at fifty routes is nothing and at five hundred is the request. The
 * score is a property of the route, so it is computed once; and a path that
 * is entirely static - most of them - is answered from a map without
 * touching the list at all. Keyed by the manifest object, so a host that
 * swaps manifests gets a fresh index and a dropped one is collected.
 */
interface Indexed<R extends { segments: RouteSegment[] }> {
  scored: { route: R; score: number }[]
  exact: Map<string, R>
}

const indexes = new WeakMap<object, Indexed<ManifestRoute>>()
const apiIndexes = new WeakMap<object, Indexed<ManifestApiRoute>>()

function indexRoutes<R extends { segments: RouteSegment[] }>(routes: R[]): Indexed<R> {
  const scored: { route: R; score: number }[] = []
  const exact = new Map<string, R>()

  for (const route of routes) {
    const score = route.segments.reduce(
      (n, s) => n + (s.type === 'static' ? 2 : s.type === 'param' ? 1 : 0),
      0,
    )

    scored.push({ route, score })

    // An all-static route matches exactly one path, with the highest score any
    // route can have for that path. First one in wins, as in the scan.
    if (route.segments.every((s) => s.type === 'static')) {
      const key = route.segments.map((s) => s.value).join('/')

      if (!exact.has(key)) exact.set(key, route)
    }
  }

  return { scored, exact }
}

function indexed(manifest: RouteManifest): Indexed<ManifestRoute> {
  let found = indexes.get(manifest)

  if (!found) {
    found = indexRoutes(manifest.routes)
    indexes.set(manifest, found)
  }

  return found
}

function indexedApis(manifest: RouteManifest): Indexed<ManifestApiRoute> {
  let found = apiIndexes.get(manifest)

  if (!found) {
    found = indexRoutes(manifest.apis ?? [])
    apiIndexes.set(manifest, found)
  }

  return found
}

export function matchApiRoute(
  manifest: RouteManifest,
  pathname: string,
): MatchedApiRoute | null {
  const parts = pathname.split('/').filter(Boolean)
  const { scored, exact } = indexedApis(manifest)
  const direct = exact.get(parts.join('/'))

  if (direct) return { route: direct, params: {} }

  let best: MatchedApiRoute | null = null
  let bestScore = -1

  for (const { route, score } of scored) {
    if (score <= bestScore) continue

    const bound = bindSegments(route.segments, parts)

    if (!bound) continue

    best = { route, params: bound }
    bestScore = score
  }

  return best
}

/**
 * What a 405 should say this route does answer.
 *
 * HEAD is included whenever GET is, because it is answered by GET.
 */
export function allowFor(route: ManifestApiRoute): string {
  const methods = route.methods.includes('HEAD') || !route.methods.includes('GET')
    ? route.methods
    : [...route.methods, 'HEAD']

  return methods.join(', ')
}

export function matchRoute(manifest: RouteManifest, pathname: string): MatchedRoute | null {
  const parts = pathname.split('/').filter(Boolean)
  const { scored, exact } = indexed(manifest)
  const direct = exact.get(parts.join('/'))

  if (direct) return { route: direct, params: {} }

  let best: MatchedRoute | null = null
  let bestScore = -1

  // More static segments wins; a catch-all is the weakest possible match. A
  // route that could not beat the best so far is not worth binding.
  for (const { route, score } of scored) {
    if (score <= bestScore) continue

    const bound = bindSegments(route.segments, parts)

    if (!bound) continue

    best = { route, params: bound }
    bestScore = score
  }

  return best
}

/**
 * The interceptor registered for a slot, if this url has one.
 *
 * Matched against the url being navigated *to*: `(.)posts/[slug]` intercepts
 * /posts/anything, and the params it binds are the target's, not the page the
 * modal opens over.
 */
export function matchIntercept(
  manifest: RouteManifest,
  pathname: string,
  slot: string,
): { component: string; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter(Boolean)
  let best: { component: string; params: Record<string, string> } | null = null
  let bestScore = -1

  for (const intercept of manifest.intercepts) {
    if (intercept.slot !== slot) continue

    const params = bindSegments(intercept.segments, parts)

    if (!params) continue

    // Scored exactly as matchRoute scores, and for the same reason: a static
    // segment beats a dynamic one at the same position. Taking the first match
    // instead made the two disagree about which route a url belongs to — and
    // the guard is chosen by one while the content comes from the other, so a
    // url could be checked against the unguarded route and rendered from the
    // guarded one.
    const score = intercept.segments.reduce(
      (n, segment) => n + (segment.type === 'static' ? 2 : segment.type === 'param' ? 1 : 0),
      0,
    )

    if (score > bestScore) {
      best = { component: intercept.component, params }
      bestScore = score
    }
  }

  return best
}

function bindSegments(segments: RouteSegment[], parts: string[]): Record<string, string> | null {
  const params: Record<string, string> = {}

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]

    if (segment.type === 'catchAll') {
      // Swallows the rest, including none of it.
      params[segment.value] = parts.slice(i).join('/')

      return params
    }

    if (i >= parts.length) return null

    if (segment.type === 'static') {
      if (parts[i] !== segment.value) return null
      continue
    }

    params[segment.value] = decodeURIComponent(parts[i])
  }

  return segments.length === parts.length ? params : null
}

/**
 * How much of the layout chain the client already holds.
 *
 * It sends the chain outermost-first; the shared prefix is what it can keep.
 * Answering with a whole document instead is not merely wasteful — it replaces
 * the root, and replacing the root unmounts every page retained behind the
 * current one, so a half-typed form does not survive going back.
 */
export function sharedDepth(held: string | null, chain: string[]): number {
  if (!held) return 0

  const mounted = held.split(',').filter(Boolean)
  let shared = 0

  while (shared < mounted.length && shared < chain.length && mounted[shared] === chain[shared]) {
    shared++
  }

  return shared
}

/**
 * What a page is remembered as, for retention and for the prefetch cache.
 *
 * The same url intercepted and not intercepted are two different things to go
 * back to — a modal over the feed, and the post on its own page — so they
 * cannot share a key or restoring one returns the other.
 *
 * Shared because both halves compute it: the host stores under this key and
 * the client looks under it. Written out at each of the seven places that
 * needed it, they only had to disagree once, and the symptom is a navigation
 * that silently rebuilds a page it was holding.
 */
export function retentionKey(path: string, interceptSlot?: string | null): string {
  const normalised = normalisePath(path)

  return interceptSlot ? `__intercept:${interceptSlot}:${normalised}` : normalised
}

/**
 * The same page written two ways is one key.
 *
 * A static host serves /orders as a directory, so the browser's url ends in a
 * slash while the build wrote the page down as /orders. Left unequal, the
 * entry retained for a page is never the one looked up on the way back: it
 * stays in the document, hidden, while a second copy is fetched and rendered
 * beside it — so the form you were filling in is there, and not the one you
 * are looking at.
 */
function normalisePath(path: string): string {
  // Absolute urls reach this from the initial page, which is identified by
  // href rather than by the path a link would use.
  const withoutOrigin = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '')
  const [pathname, rest = ''] = splitQuery(withoutOrigin)

  return (pathname.replace(/\/+$/, '') || '/') + rest
}

function splitQuery(url: string): [string, string] {
  const cut = url.search(/[?#]/)

  return cut === -1 ? [url, ''] : [url.slice(0, cut), url.slice(cut)]
}
