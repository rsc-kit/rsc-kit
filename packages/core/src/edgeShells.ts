/**
 * The pages an edge may serve without the app, for `.output/edge.json` - the
 * marker of the edge contract, which an edge reads the same way for every
 * framework that implements it: `shells`, the url patterns of the PPR pages
 * it may answer from a cached shell, and `static`, the paths of the pages it
 * may answer whole.
 *
 * An edge in front of the app asks one question of each request - may I
 * answer this? - and answers it from a list it was handed at deploy time. Reading
 * `rsc-static/` for it does not work: a guarded page has a shell on disk too,
 * served from a cache it skips its guard; `_team_` cannot say whether it was a
 * parameter or a folder of that name; and the layout is ours to change.
 *
 * So the list is the build's, by the same rule the page endpoint applies: a
 * page with a shell, on a route with no middleware - neither a `middleware.ts`
 * above it nor the host's `export const middleware`. The endpoint refuses
 * exactly those, so the list and the origin cannot disagree.
 */

import type { RouteSegment } from './manifest.js'

/** What an edge is promised, and what it can hold. */
export const MAX_SHELLS = 200
export const MAX_SHELL_BYTES = 200
/** The same again for `static`, on top of `shells`' count. */
export const MAX_STATIC = 200

/**
 * The marker. `bypass` names this framework's own requests on a page's path
 * that are not a visitor's document: every payload fetch - a navigation, a
 * prefetch, a refresh - carries X-RSC, and an action is a POST, which an edge
 * never answers from a shell anyway.
 */
export function edgeMarker(build: string, shells: string[], statics: string[]) {
  return { v: 2, build, shells, static: statics, bypass: { headers: ['X-RSC'] } }
}

export interface ShellRoute {
  component: string
  segments: RouteSegment[]
  middleware?: readonly string[]
  hostMiddleware?: readonly string[]
}

/**
 * The patterns, `/` for the index, `[name]` for one segment and a final
 * `[...name]` for one or more - and what was left out of the list, and why,
 * for the build to say.
 */
export function edgeShells(
  results: readonly { type: string; component: string }[],
  routes: readonly ShellRoute[],
): { shells: string[]; left: string[] } {
  const byComponent = new Map(routes.map((route) => [route.component, route]))
  const shells: string[] = []
  const left: string[] = []

  for (const component of new Set(results.filter((r) => r.type === 'shell').map((r) => r.component))) {
    const route = byComponent.get(component)

    if (!route) continue
    if (route.middleware?.length || route.hostMiddleware?.length) continue

    // Bound from the request's host, which a path pattern cannot say: the
    // same pattern would match every tenant's page on every domain.
    if (route.segments.some((segment) => segment.type === 'host')) continue

    const pattern = patternOf(route.segments)

    if (pattern === null) continue

    if (new TextEncoder().encode(pattern).length > MAX_SHELL_BYTES) {
      left.push(`${pattern.slice(0, 60)}… is over ${MAX_SHELL_BYTES} bytes`)
      continue
    }

    if (!shells.includes(pattern)) shells.push(pattern)
  }

  // Over the cap, the deepest are the ones not listed: an edge that does not
  // know a page is a PPR page sends it to the origin, which answers it
  // correctly, and the shallow pages are the ones most visited.
  if (shells.length > MAX_SHELLS) {
    shells.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1))
    left.push(`${shells.length - MAX_SHELLS} past the shallowest ${MAX_SHELLS}`)
    shells.length = MAX_SHELLS
  }

  shells.sort()

  return { shells, left }
}

/**
 * A route's segments as the edge matches them, or null when it cannot: a
 * catch-all anywhere but last, or a name that is itself bracketed - an
 * optional catch-all, `[[...name]]`, matches no url at all.
 */
function patternOf(segments: readonly RouteSegment[]): string | null {
  const parts: string[] = []

  for (const [index, segment] of segments.entries()) {
    // Not a path an edge can match: the contract has no empty, `.` or `..`
    // segment, and a name with a slash would be two.
    if (['', '.', '..'].includes(segment.value) || segment.value.includes('/')) return null
    if (segment.type === 'static') parts.push(segment.value)
    else if (segment.value.includes('[') || segment.value.includes(']')) return null
    else if (segment.type === 'catchAll') {
      if (index !== segments.length - 1) return null
      parts.push(`[...${segment.value}]`)
    } else parts.push(`[${segment.value}]`)
  }

  return '/' + parts.join('/')
}

function depth(pattern: string): number {
  return pattern === '/' ? 0 : pattern.split('/').length - 1
}

/**
 * The pages an edge may answer whole: frozen, so the document is the same for
 * every visitor until the next build, with no guard of either kind and not
 * bound from the host - and listed as the paths the build rendered, since
 * `static` takes no patterns: a pattern would ask the edge for paths that
 * were never rendered. A frozen redirect is not here: it has no document.
 *
 * A path a listed shell's pattern also matches is left out, so no path is
 * two things to the edge.
 */
export function edgeStatic(
  results: readonly { type: string; component: string; url: string }[],
  routes: readonly ShellRoute[],
  shells: readonly string[],
): { static: string[]; left: string[] } {
  const byComponent = new Map(routes.map((route) => [route.component, route]))
  const statics: string[] = []
  const left: string[] = []

  for (const result of results) {
    if (result.type !== 'frozen') continue

    const route = byComponent.get(result.component)

    if (!route) continue
    if (route.middleware?.length || route.hostMiddleware?.length) continue
    if (route.segments.some((segment) => segment.type === 'host')) continue

    const path = contractPath(result.url)

    if (path === null) continue

    if (new TextEncoder().encode(path).length > MAX_SHELL_BYTES) {
      left.push(`${path.slice(0, 60)}… is over ${MAX_SHELL_BYTES} bytes`)
      continue
    }

    if (shells.some((pattern) => matchesPattern(pattern, path))) continue
    if (!statics.includes(path)) statics.push(path)
  }

  if (statics.length > MAX_STATIC) {
    statics.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1))
    left.push(`${statics.length - MAX_STATIC} static past the shallowest ${MAX_STATIC}`)
    statics.length = MAX_STATIC
  }

  statics.sort()

  return { static: statics, left }
}

/**
 * Why pages an edge could otherwise have served were kept out: the outermost
 * middleware above each, with how many pages it guards. A root middleware -
 * the usual home of security headers - guards every page and empties both
 * lists, correctly, and an empty edge.json with no reason given reads as a
 * bug. So the build names the file.
 */
export function edgeGuarded(
  results: readonly { type: string; component: string }[],
  routes: readonly ShellRoute[],
): string[] {
  const byComponent = new Map(routes.map((route) => [route.component, route]))
  const counts = new Map<string, number>()

  for (const result of results) {
    if (result.type !== 'frozen' && result.type !== 'shell') continue

    const route = byComponent.get(result.component)
    const guard = route?.middleware?.[0] ?? (route?.hostMiddleware?.length ? `the host's ${route.hostMiddleware[0]}` : null)

    if (guard) counts.set(guard, (counts.get(guard) ?? 0) + 1)
  }

  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([guard, n]) => `${guard} (${n})`)
}

/**
 * A rendered url as the contract lists it - absolute, decoded once, no query
 * - or null when it has no such form: an empty, `.` or `..` segment, or one
 * holding a `/` once decoded.
 */
export function contractPath(url: string): string | null {
  const path = url.split(/[?#]/)[0]

  if (!path.startsWith('/')) return null
  if (path === '/') return path

  const parts: string[] = []

  for (const raw of path.slice(1).split('/')) {
    let part: string

    try {
      part = decodeURIComponent(raw)
    } catch {
      return null
    }

    if (['', '.', '..'].includes(part) || part.includes('/') || /[?#]/.test(part)) return null
    parts.push(part)
  }

  return '/' + parts.join('/')
}

/** A marker pattern against a path: `[name]` is one segment, a final `[...name]` one or more. */
export function matchesPattern(pattern: string, path: string): boolean {
  const want = pattern.split('/')
  const have = path.split('/')

  for (const [i, part] of want.entries()) {
    if (i === want.length - 1 && /^\[\.\.\..+\]$/.test(part)) {
      return have.length > i && have.slice(i).every(Boolean)
    }

    if (have[i] === undefined) return false
    if (/^\[.+\]$/.test(part) ? have[i] === '' : part !== have[i]) return false
  }

  return want.length === have.length
}
