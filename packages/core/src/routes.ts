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
//   declare module '@rsc-router/core/routes' {
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
