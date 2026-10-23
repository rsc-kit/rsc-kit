/**
 * The url patterns of the pages an edge may serve from a cached shell, for
 * `.output/rsc-kit.json`.
 *
 * An edge in front of the app asks one question of each request - is this a
 * PPR page? - and answers it from a list it was handed at deploy time. Reading
 * `rsc-static/` for it does not work: a guarded page has a shell on disk too,
 * served from a cache it skips its guard; `_team_` cannot say whether it was a
 * parameter or a folder of that name; and the layout is ours to change.
 *
 * So the list is the build's, by the same rule the shell endpoint applies: a
 * page with a shell, on a route with no middleware - neither a `middleware.ts`
 * above it nor the host's `export const middleware`. The endpoint refuses
 * exactly those, so the list and the origin cannot disagree.
 */

import type { RouteSegment } from './manifest.js'

/** What an edge is promised, and what it can hold. */
export const MAX_SHELLS = 200
export const MAX_SHELL_BYTES = 200

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

    if (new TextEncoder().encode(pattern).length >= MAX_SHELL_BYTES) {
      left.push(`${pattern.slice(0, 60)}… is ${MAX_SHELL_BYTES} bytes or more`)
      continue
    }

    if (!shells.includes(pattern)) shells.push(pattern)
  }

  shells.sort()

  // Over the cap, the rest are simply not listed: an edge that does not know a
  // page is a PPR page sends it to the origin, which answers it correctly.
  if (shells.length > MAX_SHELLS) {
    left.push(`${shells.length - MAX_SHELLS} past the first ${MAX_SHELLS}`)
    shells.length = MAX_SHELLS
  }

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
    if (segment.type === 'static') parts.push(segment.value)
    else if (segment.value.includes('[') || segment.value.includes(']')) return null
    else if (segment.type === 'catchAll') {
      if (index !== segments.length - 1) return null
      parts.push(`[...${segment.value}]`)
    } else parts.push(`[${segment.value}]`)
  }

  return '/' + parts.join('/')
}
