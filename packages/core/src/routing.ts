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

import type { ManifestRoute, RouteManifest, RouteSegment } from './manifest.js'

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
export function matchRoute(manifest: RouteManifest, pathname: string): MatchedRoute | null {
  const parts = pathname.split('/').filter(Boolean)
  let best: MatchedRoute | null = null
  let bestScore = -1

  for (const route of manifest.routes) {
    const bound = bindSegments(route.segments, parts)

    if (!bound) continue

    // More static segments wins; a catch-all is the weakest possible match.
    const score = route.segments.reduce(
      (n, s) => n + (s.type === 'static' ? 2 : s.type === 'param' ? 1 : 0),
      0,
    )

    if (score > bestScore) {
      best = { route, params: bound }
      bestScore = score
    }
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

  for (const intercept of manifest.intercepts) {
    if (intercept.slot !== slot) continue

    const params = bindSegments(intercept.segments, parts)

    if (params) return { component: intercept.component, params }
  }

  return null
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
