// Typed routes: the urls this app can actually answer, as a type.
//
// Laravel needs route() because the url lives in PHP and can move
// independently of the name it is called by. Here the url *is* the file path,
// so a name would be indirection that buys nothing. What is worth having is
// the other half — a link to a page that does not exist should fail at build
// time rather than in the browser.
//
// There is no route() builder to go with this, deliberately. A template
// literal is checked the same way — `/posts/${slug}` compiles and
// `/postz/${slug}` does not — so a builder would only wrap what the language
// already does. Encoding a value that is not url-safe is `encodeURIComponent`
// in the template, the same as anywhere else.
//
// The build already walks app/ and knows every route's segments, so it writes
// one line into the app's source dir:
//
//   declare module '@rsc-kit/core/routes' {
//     interface Register { routes: '/' | '/posts/[slug]' }
//   }
//
// Everything below is derived from that union. An app that never runs the
// generator — a generic host, a Laravel app that has not rebuilt — registers
// nothing, `RoutePattern` stays `string`, and every url-taking API is exactly
// as permissive as it was before. That fallback is the reason this can ship
// without a flag.

/**
 * Augmented by the generated `rsc-routes.d.ts`. Empty here on purpose.
 *
 * Declaration merging rather than a generic parameter, because the routes are
 * a property of the project, not of each call site — threading them through
 * every component that renders a Link is not a thing anyone would do twice.
 */
export interface Register {}

/** The route patterns this app declared: `'/posts/[slug]'`. */
export type RoutePattern = Register extends { routes: infer R extends string } ? R : string

/** Whether anything was registered. `string` means the generator never ran. */
type Unregistered = string extends RoutePattern ? true : false

/**
 * A pattern with its dynamic segments opened up: `/posts/[slug]` accepts
 * `/posts/anything`.
 *
 * Catch-all and single params both become `${string}`, which for a catch-all
 * also swallows the slashes — `/docs/[...path]` accepts `/docs/a/b/c`.
 */
type Filled<P extends string> = P extends `${infer A}[...${string}]${infer B}`
  ? `${A}${string}${Filled<B>}`
  : P extends `${infer A}[${string}]${infer B}`
    ? `${A}${string}${Filled<B>}`
    : P

/**
 * Not a route, but a legitimate href: another site, a mail client, a phone
 * number, an anchor on this page, a bare query string.
 */
type OffRoute = `${string}://${string}` | `mailto:${string}` | `tel:${string}` | `#${string}` | `?${string}`

/**
 * A url this app can answer, or one that deliberately leaves it.
 *
 * Cast when the destination is computed rather than written:
 * `href={path as Href}`.
 */
export type Href = Unregistered extends true
  ? string
  : Filled<RoutePattern> | `${Filled<RoutePattern>}?${string}` | `${Filled<RoutePattern>}#${string}` | OffRoute

// ── Api routes ───────────────────────────────────────────────────────────────
//
// Their own union rather than part of Href, because they are not pages and a
// link to one is almost always a mistake — an <a href="/api/orders"> navigates
// the browser away to a json document. Keeping them apart means `Link` refuses
// an api url and `apiUrl()` refuses a page, which is the pair of mistakes worth
// catching.

/** Augmented by the generated `rsc-routes.d.ts`, like `Register`. */
export interface RegisterApi {}

/** The api route patterns this app declared: `'/api/orders/[id]'`. */
export type ApiPattern = RegisterApi extends { apis: infer R extends string } ? R : string

type NoApis = string extends ApiPattern ? true : false

/**
 * A url an api route in this app answers.
 *
 * `/api/orders/[id]` accepts `/api/orders/42`, and a query string is allowed
 * because that is how a GET is parameterised.
 */
export type ApiHref = NoApis extends true
  ? string
  : Filled<ApiPattern> | `${Filled<ApiPattern>}?${string}`

/**
 * An api url, checked against the routes the build found.
 *
 *     await fetch(apiUrl(`/api/orders/${id}`))
 *
 * A function rather than a bare type so it can be used inline at a call site
 * that is typed `string` — `fetch` takes any string, so nothing would check the
 * argument without somewhere to put the type. It returns what it was given.
 *
 * Wrong path, and it stops compiling. Renamed the directory, and every call
 * site says so rather than one of them 404ing in production.
 */
export function apiUrl(href: ApiHref): string {
  return href
}

// ── Search params, typed per route ───────────────────────────────────────────
//
// A page that exports a `searchParams` schema has said what its query string
// means. The generated file records that schema per pattern:
//
//   interface Register {
//     search: { '/search': SearchExportOf<typeof import('../src/app/search/page')> }
//   }
//
// and from there a link to `/search` is checked against the same schema the
// page parses with — a `page` that must be a number is a number on the link,
// a `q` the page requires is required to write the link, and a key the page
// never reads does not compile. One schema, both ends. A route that exports
// none takes anything; an href that is not a single route (computed, cast, or
// off-site) takes anything too, because there is nothing to check it against.

/** What a page module contributes: its `searchParams` export, or nothing. For the generated file. */
export type SearchExportOf<M> = M extends { searchParams: infer S } ? S : undefined

type SearchMap = Register extends { search: infer M } ? M : {}

type StripQuery<H extends string> = H extends `${infer P}?${string}` ? P : H extends `${infer P}#${string}` ? P : H

/** The pattern a written href belongs to: `/posts/hello` is `/posts/[slug]`. */
type PatternOf<H extends string> = RoutePattern extends infer P
  ? P extends string
    ? StripQuery<H> extends Filled<P>
      ? P
      : never
    : never
  : never

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never

type SchemaFor<P> = P extends keyof SearchMap ? SearchMap[P] : undefined

type InputOf<S> = S extends { '~standard': { types?: { input: infer I } } } ? I : never
type OutputOf<S> = S extends { '~standard': { types?: { output: infer O } } } ? O : never

type OptionalKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T]
type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>
type Simplify<T> = { [K in keyof T]: T[K] } & {}

/**
 * What a link may write for a schema: the keys the schema's input requires
 * are required, the rest optional, and every value is the schema's OUTPUT
 * type. Output rather than input because `z.coerce.number()` takes `unknown`
 * in - that is what coercion means - and a link typed by it would accept
 * `page: 'two'`. The output is the number the page will actually see.
 */
type LinkInputOf<S> = Simplify<
  { [K in RequiredKeys<InputOf<S>> & keyof OutputOf<S>]: OutputOf<S>[K] } & {
    [K in OptionalKeys<InputOf<S>> & keyof OutputOf<S>]?: OutputOf<S>[K]
  }
>

type Scalar = string | number | boolean | null | undefined

/** What a link may carry when nothing declares otherwise. */
export type LooseSearch = Record<string, Scalar | readonly (string | number)[]>

/**
 * The search params a link to `H` may carry.
 *
 * The page's schema input when `H` is one declared route with a schema;
 * otherwise anything. "One route" matters: `path as Href` is every route at
 * once, and a link that could go anywhere cannot be held to one page's schema.
 */
export type SearchFor<H extends string> = Unregistered extends true
  ? LooseSearch
  : IsUnion<H> extends true
    ? LooseSearch
    : [PatternOf<H>] extends [never]
      ? LooseSearch
      : SchemaFor<PatternOf<H>> extends undefined
        ? LooseSearch
        : LinkInputOf<SchemaFor<PatternOf<H>>>

/**
 * The `search` prop, required exactly when the page's schema has a required
 * key. A page that needs `q` is not reachable without one, so the link that
 * omits it is the bug — caught here rather than on the page's error boundary.
 */
export type SearchProp<H extends string> = {} extends SearchFor<H>
  ? { search?: SearchFor<H> }
  : { search: SearchFor<H> }

/** A query string from an object: scalars stringified, arrays repeated, null and undefined dropped. */
export function searchString(search: object): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(search)) {
    if (value === null || value === undefined) continue

    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
    } else {
      params.set(key, String(value))
    }
  }

  return params.toString()
}

/** `path` with `search` appended, keeping any query and hash already on it. */
export function withSearch(path: string, search: object | undefined): string {
  if (!search) return path

  const hashAt = path.indexOf('#')
  const hash = hashAt === -1 ? '' : path.slice(hashAt)
  const before = hashAt === -1 ? path : path.slice(0, hashAt)
  const queryAt = before.indexOf('?')
  const base = queryAt === -1 ? before : before.slice(0, queryAt)
  const existing = queryAt === -1 ? '' : before.slice(queryAt + 1)
  const added = searchString(search)
  const query = [existing, added].filter(Boolean).join('&')

  return query ? `${base}?${query}${hash}` : `${base}${hash}`
}

/**
 * A typed url with its search params, for the places that take a string.
 *
 *     visit(href('/search', { q: 'shoes', page: 2 }))
 *
 * `Link` has the same check on its own `search` prop. This is for `visit`,
 * `prefetch`, `redirect` and anything else that wants the finished string.
 */
export function href<H extends Href>(
  path: H,
  ...rest: {} extends SearchFor<H> ? [search?: SearchFor<H>] : [search: SearchFor<H>]
): Href {
  return withSearch(path, rest[0] as object | undefined) as Href
}
