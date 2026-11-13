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
export type RoutePattern = Register extends { routes: infer R extends string }
  ? R
  : string;

/** Whether anything was registered. `string` means the generator never ran. */
type Unregistered = string extends RoutePattern ? true : false;

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
    : P;

/**
 * Not a route, but a legitimate href: another site, a mail client, a phone
 * number, an anchor on this page, a bare query string.
 */
type OffRoute =
  | `${string}://${string}`
  | `mailto:${string}`
  | `tel:${string}`
  | `#${string}`
  | `?${string}`;

/**
 * A url this app can answer, or one that deliberately leaves it.
 *
 * Cast when the destination is computed rather than written:
 * `href={path as Route}`.
 */
/**
 * A url this app answers - a page or a route.ts - or one that deliberately
 * leaves it. One type, as Next's `Route` is one type: what `<Link href>`,
 * `visit()` and `redirect()` take. A route.ts is a full navigation rather
 * than a payload fetch, and never prefetched - the client knows which urls
 * are routes and treats a link to one as the anchor it is - so the type
 * does not have to keep them apart to keep a hover from running one.
 *
 * `Route` is the same type under the name Next uses, so a port keeps the
 * word it already has.
 */
export type Route = Unregistered extends true
  ? string
  : | Filled<RoutePattern>
    | `${Filled<RoutePattern>}?${string}`
    | `${Filled<RoutePattern>}#${string}`
    | Filled<ApiPattern>
    | `${Filled<ApiPattern>}?${string}`
    | BackendUrl
    | OffRoute;

// ── The backend's urls ───────────────────────────────────────────────────────
//
// `rscKit({ backendPaths: ['/gitlab'] })` names the prefixes the backend owns.
// They are not in the route tree, so a link or a redirect to `/gitlab/connect`
// needed a cast to compile, for a url the app itself had declared. They are a
// place to go and, like a route.ts, a full page load.

/** Augmented by the generated `rsc-routes.d.ts`, like `Register`. */
export interface RegisterBackend {}

/** The prefixes `backendPaths` named: `'/gitlab'`. */
type BackendPrefix = RegisterBackend extends { paths: infer P extends string }
  ? P
  : never;

/**
 * A prefix and everything under it, at a segment boundary: `/gitlab`,
 * `/gitlab/connect?next=/`, never `/gitlabs`. `never` when nothing was named.
 */
type BackendUrl =
  | BackendPrefix
  | `${BackendPrefix}/${string}`
  | `${BackendPrefix}?${string}`
  | `${BackendPrefix}#${string}`;

// ── Api routes ───────────────────────────────────────────────────────────────
//
// Their own union rather than part of Route, because they are not pages and a
// link to one is almost always a mistake — an <a href="/api/orders"> navigates
// the browser away to a json document. Keeping them apart means `Link` refuses
// an api url and `apiUrl()` refuses a page, which is the pair of mistakes worth
// catching.

/** Augmented by the generated `rsc-routes.d.ts`, like `Register`. */
export interface RegisterApi {}

// ── Regions a page can re-render on its own ──────────────────────────────────
//
// Every `section('name', …)` the build found, and every `@slot` directory.
// `revalidate('orders')` is checked against them, so a name that matches no
// section - a typo, or a section renamed since - stops compiling instead of
// being refused by the renderer at runtime.

/** Augmented by the generated `rsc-routes.d.ts`, like `Register`. */
export interface RegisterRegions {}

/** The region names the build found: section names and slot names. */
export type RegionName = RegisterRegions extends {
  regions: infer R extends string;
}
  ? R
  : string;

type NoRegions = string extends RegionName ? true : false;

/**
 * What `revalidate()` takes: the page, the whole document, or a region by
 * name. `string` until the build has written the types.
 */
export type RevalidateTarget = NoRegions extends true
  ? string
  : "page" | "all" | RegionName;

/** The api route patterns this app declared: `'/api/orders/[id]'`. */
export type ApiPattern = RegisterApi extends { apis: infer R extends string }
  ? R
  : string;

type NoApis = string extends ApiPattern ? true : false;

/**
 * A url an api route in this app answers.
 *
 * `/api/orders/[id]` accepts `/api/orders/42`, and a query string is allowed
 * because that is how a GET is parameterised.
 */
export type ApiRoute = NoApis extends true
  ? string
  : Filled<ApiPattern> | `${Filled<ApiPattern>}?${string}`;

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
export function apiUrl(href: ApiRoute): string {
  return href;
}

// ── What an events route sends ───────────────────────────────────────────────
//
// A route.ts whose GET is `events(...)` says, as a type, what its generator
// yields. The generated file records that per api pattern:
//
//   interface RegisterApi {
//     events: { '/api/orders/[id]/events': EventsExportOf<typeof import('../src/app/api/orders/[id]/events/route')> }
//   }
//
// and `useEvents` reads a url's messages from it, so the hook and the route
// cannot disagree about a message's shape.

/** What a route module's GET yields, when it is `events(...)`; `unknown` for any other stream. */
export type EventsExportOf<M> = M extends {
  GET: { readonly "~events"?: infer S };
}
  ? NonNullable<S> extends { yields: infer Y }
    ? Y
    : unknown
  : unknown;

type EventsMap = RegisterApi extends { events: infer M } ? M : {};

type Split<S extends string> = S extends `${infer A}/${infer B}`
  ? [A, ...Split<B>]
  : [S];

/**
 * Whether a url's segments fit a pattern's, one segment at a time. Unlike
 * `Filled`, a `[id]` takes exactly one segment, so `/api/orders/42/events`
 * is `/api/orders/[id]/events` and not also `/api/orders/[id]`.
 */
type Fits<H extends string[], P extends string[]> = P extends [
  infer P0 extends string,
  ...infer PR extends string[],
]
  ? P0 extends `[...${string}]`
    ? H extends [string, ...string[]]
      ? true
      : false
    : H extends [infer H0 extends string, ...infer HR extends string[]]
      ? P0 extends `[${string}]`
        ? Fits<HR, PR>
        : H0 extends P0
          ? Fits<HR, PR>
          : false
      : false
  : H extends []
    ? true
    : false;

/** The api pattern a written url belongs to: `/api/orders/42/events` is `/api/orders/[id]/events`. */
type ApiPatternOf<H extends string> = ApiPattern extends infer P
  ? P extends string
    ? Fits<Split<StripQuery<H>>, Split<P>> extends true
      ? P
      : never
    : never
  : never;

/**
 * Everything the stream at `H` yields, named events included. `unknown` when
 * `H` is not one api route the build found - a url computed at runtime, or
 * another site's - since there is nothing to read it from.
 */
export type EventsAt<H extends string> = NoApis extends true
  ? unknown
  : IsUnion<H> extends true
    ? unknown
    : [ApiPatternOf<H>] extends [never]
      ? unknown
      : ApiPatternOf<H> extends keyof EventsMap
        ? EventsMap[ApiPatternOf<H>]
        : unknown;

/** A url `useEvents` may open: an api route this app answers, or another site's stream. */
export type EventsUrl = ApiRoute | `${string}://${string}`;

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
export type SearchExportOf<M> = M extends { searchParams: infer S }
  ? S
  : undefined;

type SearchMap = Register extends { search: infer M } ? M : {};

type StripQuery<H extends string> = H extends `${infer P}?${string}`
  ? P
  : H extends `${infer P}#${string}`
    ? P
    : H;

/** The pattern a written href belongs to: `/posts/hello` is `/posts/[slug]`. */
type PatternOf<H extends string> = RoutePattern extends infer P
  ? P extends string
    ? StripQuery<H> extends Filled<P>
      ? P
      : never
    : never
  : never;

type IsUnion<T, U = T> = T extends unknown
  ? [U] extends [T]
    ? false
    : true
  : never;

type SchemaFor<P> = P extends keyof SearchMap ? SearchMap[P] : undefined;

type InputOf<S> = S extends { "~standard": { types?: { input: infer I } } }
  ? I
  : never;
type OutputOf<S> = S extends { "~standard": { types?: { output: infer O } } }
  ? O
  : never;

type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];
type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>;
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * What a link may write for a schema: the keys the schema's input requires
 * are required, the rest optional, and every value is the schema's OUTPUT
 * type. Output rather than input because `z.coerce.number()` takes `unknown`
 * in - that is what coercion means - and a link typed by it would accept
 * `page: 'two'`. The output is the number the page will actually see.
 */
type LinkInputOf<S> = Simplify<
  { [K in RequiredKeys<InputOf<S>> & keyof OutputOf<S>]: OutputOf<S>[K] } & {
    [K in OptionalKeys<InputOf<S>> & keyof OutputOf<S>]?: OutputOf<S>[K];
  }
>;

type Scalar = string | number | boolean | null | undefined;

/** What a link may carry when nothing declares otherwise. */
export type LooseSearch = Record<string, Scalar | readonly (string | number)[]>;

/**
 * The search params a link to `H` may carry.
 *
 * The page's schema input when `H` is one declared route with a schema;
 * otherwise anything. "One route" matters: `path as Route` is every route at
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
        : LinkInputOf<SchemaFor<PatternOf<H>>>;

/**
 * The `search` prop, required exactly when the page's schema has a required
 * key. A page that needs `q` is not reachable without one, so the link that
 * omits it is the bug — caught here rather than on the page's error boundary.
 */
export type SearchProp<H extends string> =
  {} extends SearchFor<H>
    ? { search?: SearchFor<H> }
    : { search: SearchFor<H> };

/** A query string from an object: scalars stringified, arrays repeated, null and undefined dropped. */
export function searchString(search: object): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.set(key, String(value));
    }
  }

  return params.toString();
}

/** `path` with `search` appended, keeping any query and hash already on it. */
export function withSearch(path: string, search: object | undefined): string {
  if (!search) return path;

  const hashAt = path.indexOf("#");
  const hash = hashAt === -1 ? "" : path.slice(hashAt);
  const before = hashAt === -1 ? path : path.slice(0, hashAt);
  const queryAt = before.indexOf("?");
  const base = queryAt === -1 ? before : before.slice(0, queryAt);
  const existing = queryAt === -1 ? "" : before.slice(queryAt + 1);
  const added = searchString(search);
  const query = [existing, added].filter(Boolean).join("&");

  return query ? `${base}?${query}${hash}` : `${base}${hash}`;
}

/**
 * A typed url with its search params, for the places that take a string.
 *
 *     visit(href('/search', { q: 'shoes', page: 2 }))
 *
 * `Link` has the same check on its own `search` prop. This is for `visit`,
 * `prefetch`, `redirect` and anything else that wants the finished string.
 */
export function href<H extends Route>(
  path: H,
  ...rest: {} extends SearchFor<H>
    ? [search?: SearchFor<H>]
    : [search: SearchFor<H>]
): Route {
  return withSearch(path, rest[0] as object | undefined) as Route;
}

// ── Another host ─────────────────────────────────────────────────────────────
//
// A page under app/merchant is reached as merchant.example.com/orders as well
// as example.com/merchant/orders, and a page under app/[domain] only from the
// tenant's own host. A typed `href` names the folder path, which is the second
// of those - and the first is a host Link cannot know you meant. So the host is
// said where it is meant, and the path is typed for it.

/** The site's host, from rscKit({ hosts }) or a literal metadataBase, baked in by the build. */
declare const __RSC_SITE_HOST__: string | null | undefined;

/** A top-level folder a url can begin with: `merchant` for app/merchant. */
type TopFolder<P> = P extends `/${infer F}/${string}`
  ? F extends `[${string}` ? never : F
  : P extends `/${infer F}`
    ? F extends `[${string}` | "" ? never : F
    : never;

/** The patterns under `/${F}`, with the folder taken off: `/merchant/orders` → `/orders`. */
type Under<P, F extends string> = P extends `/${F}`
  ? "/"
  : P extends `/${F}/${infer R}`
    ? `/${R}`
    : never;

/** A tenant tree's patterns, with the tenant taken off: `/[domain]/settings` → `/settings`. */
type TenantPaths<P> = P extends `/[domain]${infer R}` | `/[host]${infer R}`
  ? R extends "" ? "/" : R
  : never;

type WithQuery<P extends string> = P | `${P}?${string}` | `${P}#${string}`;

/**
 * What `hostUrl`'s first argument autocompletes to: every top-level folder.
 * Any other string is taken too - a tenant's subdomain, a custom domain.
 */
export type HostName = Unregistered extends true ? string : HostFolder | (string & {});

/** The top-level folders of the route tree: `merchant` for app/merchant. */
export type HostFolder = TopFolder<RoutePattern>;

/**
 * The paths a host answers: for a folder's subdomain the pages under that
 * folder; for anything else the tenant tree's, or any path when there is none.
 */
export type HostPath<H extends string> = Unregistered extends true
  ? string
  : H extends HostFolder
    ? WithQuery<Filled<Under<RoutePattern, H>>>
    : [TenantPaths<RoutePattern>] extends [never]
      ? `/${string}`
      : WithQuery<Filled<TenantPaths<RoutePattern>>>;

/**
 * A url on another host of the site, for `<Link href>`, `visit()` and
 * `redirect()`:
 *
 *     hostUrl('merchant', '/orders')    // //merchant.example.com/orders
 *     hostUrl('testbrand', '/settings') // //testbrand.example.com/settings - a tenant
 *     hostUrl('acme.com', '/settings')  // //acme.com/settings - a name with a dot is a whole domain
 *     hostUrl('/pricing')               // //example.com/pricing - the site itself
 *
 * The site's host is the one rscKit({ hosts }) names first. Where none is
 * named, a folder's url is its path - `/merchant/orders` - as every page is
 * then reached by path; a tenant or a domain still names its host.
 *
 * The same string on the server and in the browser, so a link hydrates as
 * it rendered. On the host it names already, Link navigates without a reload.
 */
export function hostUrl(path: Route): Route;
export function hostUrl<H extends HostName>(host: H, path: HostPath<H>): Route;
export function hostUrl(host: string, path?: string): Route {
  const site = typeof __RSC_SITE_HOST__ === "string" ? __RSC_SITE_HOST__ : null;

  if (path === undefined) return (site ? `//${site}${host}` : host) as Route;
  if (host.includes(".")) return `//${host}${path}` as Route;
  if (site) return `//${host}.${site}${path}` as Route;

  return `/${host}${path === "/" ? "" : path.startsWith("/?") || path.startsWith("/#") ? path.slice(1) : path}` as Route;
}
