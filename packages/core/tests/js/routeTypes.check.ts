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
import { apiUrl, href } from '../../src/routes'
import { redirect } from '../../src/redirect'
import { revalidate } from '../../src/revalidate'
import { refresh } from '../../src/js/router'
import type { RevalidateTarget } from '../../src/routes'
import type { ApiHref, Href, RoutePattern, SearchFor, SearchProp } from '../../src/routes'

// Two schemas, shaped like what a page exports, without a validator library:
// the Standard Schema `~standard.types` slot is all the typing reads.
type Schema<I, O> = { '~standard': { version: 1; vendor: 'test'; types?: { input: I; output: O } } }
declare const searchSchema: Schema<{ q?: unknown; page?: unknown }, { q: string; page: number }>
declare const filterSchema: Schema<{ kind: string; sort?: string }, { kind: 'a' | 'b'; sort: string }>

declare module '../../src/routes' {
  interface Register {
    routes: '/' | '/orders' | '/posts/[slug]' | '/docs/[...path]' | '/t/[team]/[project]'
    search: {
      '/orders': typeof searchSchema
      '/posts/[slug]': typeof filterSchema
      // The rest declare nothing, the way SearchExportOf<…> resolves for a
      // page without the export.
      '/': undefined
      '/docs/[...path]': undefined
      '/t/[team]/[project]': undefined
    }
  }

  interface RegisterRegions {
    regions: 'orders' | 'modal'
  }
  interface RegisterApi {
    apis: '/api/health' | '/api/orders/[id]' | '/docs/[...path]'
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


// ── Search params, per route ─────────────────────────────────────────────────
//
// Keys required by the schema's input are required on the link; every value
// is the schema's OUTPUT type, because a coercing schema takes `unknown` in
// and a link typed by that would accept `page: 'two'`. A route with no schema
// takes any scalars, and so does an href that is not one route.

const searchOk: SearchFor<'/orders'> = { q: 'shoes', page: 2 }
const searchPartial: SearchFor<'/orders'> = { page: 2 }
const searchNone: SearchFor<'/orders'> = {}
// @ts-expect-error page is the output type, a number
const searchText: SearchFor<'/orders'> = { page: '2' }
// @ts-expect-error a key the page never reads
const searchExtra: SearchFor<'/orders'> = { sort: 'asc' }

// A dynamic route resolves to its pattern's schema.
const filled: SearchFor<'/posts/hello'> = { kind: 'a' }
// @ts-expect-error the output type is the enum
const filledWrong: SearchFor<'/posts/hello'> = { kind: 'c' }

// Required in the input → required on the link.
const requiredProp: SearchProp<'/posts/hello'> = { search: { kind: 'b' } }
// @ts-expect-error `kind` is required, so `search` is
const missingProp: SearchProp<'/posts/hello'> = {}
// All optional → the prop is optional.
const optionalProp: SearchProp<'/orders'> = {}

// No schema: anything scalar, arrays included.
const loose: SearchFor<'/'> = { utm: 'x', n: 1, on: true, tags: ['a', 'b'] }
// A computed href is every route at once, so it cannot be held to one schema.
const anyRoute: SearchFor<Href> = { whatever: 1 }
// Off-site, likewise.
const offSite: SearchFor<'https://example.com'> = { ref: 'x' }

// href() carries the same check to visit(), prefetch() and redirect().
const built = href('/orders', { page: 2 })
const builtLoose = href('/', { utm: 'x' })
const builtRequired = href('/posts/hello', { kind: 'a' })
// @ts-expect-error page is a number
const builtWrong = href('/orders', { page: 'two' })
// @ts-expect-error kind is required
const builtMissing = href('/posts/hello')

export { searchOk, searchPartial, searchNone, searchText, searchExtra, filled, filledWrong }
export { requiredProp, missingProp, optionalProp, loose, anyRoute, offSite }
export { built, builtLoose, builtRequired, builtWrong, builtMissing }

// ── redirect(): the same search check Link's prop has ────────────────────────

declare const never: never
void never

function redirects(): void {
  redirect('/orders', { search: { q: 'shoes', page: 2 } })
  redirect('/orders', { search: { page: 2 }, status: 308 })
  redirect('/orders')
  redirect('/orders', 308)
  // @ts-expect-error page is the output type, a number
  redirect('/orders', { search: { page: '2' } })
  // @ts-expect-error a key the page never reads
  redirect('/orders', { search: { sort: 'asc' } })
  // @ts-expect-error `kind` is required for this page, so `search` is
  redirect('/posts/hello')
  redirect('/posts/hello', { search: { kind: 'b' } })
}
void redirects

// ── revalidate(): the regions the build found ────────────────────────────────

function revalidates(): void {
  revalidate('page')
  revalidate('all')
  revalidate('orders')
  revalidate('modal')
  // @ts-expect-error no such section or slot
  revalidate('order')
  // A computed name could be anything; cast it deliberately, as with Href.
  revalidate(('or' + 'ders') as RevalidateTarget)
}
void revalidates

// refresh() is the client's twin, checked against the same names.
function refreshes(): void {
  void refresh()
  void refresh('all')
  void refresh('orders')
  // @ts-expect-error no such section or slot
  void refresh('order')
}
void refreshes
