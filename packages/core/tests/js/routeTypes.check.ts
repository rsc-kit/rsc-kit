/**
 * Typed routes, checked by the typechecker rather than at runtime.
 *
 * Not a .test.ts: what this pins has no runtime behaviour to assert. A link to
 * a page that does not exist has to stop compiling, and — just as important —
 * every legitimate href has to keep compiling, or the feature is a tax rather
 * than a check.
 *
 * The union normally arrives from the app's generated `rsc-routes.d.ts`. Here
 * it is declared inline, because a fixture's routes are what this is about and
 * a test that depended on a build having run would pass for the wrong reason.
 *
 * `bun run typecheck` is what runs it.
 */
import { apiUrl } from '../../src/routes'
import type { ApiHref, Href, RoutePattern } from '../../src/routes'

declare module '../../src/routes' {
  interface Register {
    routes: '/' | '/orders' | '/posts/[slug]' | '/docs/[...path]' | '/t/[team]/[project]'
  }

  interface RegisterApi {
    apis: '/api/health' | '/api/orders/[id]'
  }
}

// ── Hrefs that have to keep working ──────────────────────────────────────────

const staticRoute: Href = '/orders'
const root: Href = '/'
const dynamic: Href = '/posts/hello'
const catchAll: Href = '/docs/guides/forms'
const twoParams: Href = '/t/acme/site'
const withQuery: Href = '/orders?page=2'
const withHash: Href = '/orders#top'
const external: Href = 'https://example.com/x'
const mail: Href = 'mailto:a@b.c'
const tel: Href = 'tel:+15551234'
const anchor: Href = '#section'
const bareQuery: Href = '?page=2'

// ── Hrefs that have to fail ──────────────────────────────────────────────────

// @ts-expect-error no such route — this is the whole point
const typo: Href = '/ordres'
// @ts-expect-error a computed string could be anything; cast it deliberately
const computed: Href = String(Math.round(1))
// Accepted, and cannot be otherwise: a dynamic segment widens to `${string}`,
// and a template literal type has no way to say "no slashes in here". So a
// typo in a *static* part of a path is caught and an extra segment after a
// param is not. Recorded here so the limit is a known one.
const tooDeep: Href = '/posts/a/b'

// ── A template literal is the ordinary way, and is checked ───────────────────

declare const slug: string
declare const id: number

const interpolated: Href = `/posts/${slug}`
const numeric_: Href = `/posts/${id}`
const twoInterpolated: Href = `/t/${slug}/${slug}`

// @ts-expect-error the static part around the value is checked too
const wrongPrefix: Href = `/postz/${slug}`
// @ts-expect-error `+` produces `string`, which could be anything
const concatenated: Href = '/posts/' + slug

// A value that is not url-safe is encoded in the template, the same as
// anywhere else. There is no builder to reach for and nothing to remember.
const encoded: Href = `/posts/${encodeURIComponent(slug)}`

// ── The registration seam ────────────────────────────────────────────────────

const pattern: RoutePattern = '/posts/[slug]'
// @ts-expect-error patterns are the declared ones, not filled-in urls
const notAPattern: RoutePattern = '/posts/hello'

export { staticRoute, root, dynamic, catchAll, twoParams, withQuery, withHash }
export { external, mail, tel, anchor, bareQuery, typo, computed, tooDeep }
export { pattern, notAPattern }

// ── Api routes ───────────────────────────────────────────────────────────────
//
// A separate union from Href, so each refuses the other's urls. Linking to an
// api route navigates the browser away to a json document, and fetching a page
// gets html where json was expected — both are worth catching.

const apiStatic: ApiHref = '/api/health'
const apiDynamic: ApiHref = `/api/orders/${id}`
const apiQuery: ApiHref = '/api/health?verbose=1'

// @ts-expect-error a page is not an api route
const pageAsApi: ApiHref = '/orders'
// @ts-expect-error and an api route is not a page, so Link refuses it
const apiAsPage: Href = '/api/health'
// @ts-expect-error the static part is checked around the value
const apiTypo: ApiHref = `/api/ordrs/${id}`

// The function exists so the check reaches a call site typed `string`: fetch
// takes any string, so nothing would check this argument without it.
const fetched = apiUrl(`/api/orders/${id}`)
// @ts-expect-error same check, at the call site
const badFetch = apiUrl('/api/nope')
export { interpolated, numeric_, twoInterpolated, wrongPrefix, concatenated, encoded }
export { apiStatic, apiDynamic, apiQuery, pageAsApi, apiAsPage, apiTypo, fetched, badFetch }

