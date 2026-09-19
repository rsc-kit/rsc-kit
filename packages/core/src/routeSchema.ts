// Typing and checking what a url carries.
//
//   // src/app/posts/[slug]/page.tsx
//   export const params = z.object({ slug: z.string().min(1) })
//   export const searchParams = z.object({
//     page: z.coerce.number().int().min(1).default(1),
//   })
//
// Both are ordinary exports beside the page, read by the build the same way
// `metadata` and `generateStaticParams` are. Any Standard Schema works — Zod,
// Valibot, ArkType — because the schema is asked to validate itself and this
// module never imports one.
//
// What it buys beyond types: `?page=3` arrives as the number 3 rather than the
// string "3", a missing one arrives as the default rather than undefined, and
// `?page=banana` is refused in one place instead of surviving as NaN into
// whatever the page does with it.
//
// The two fail differently, and that is the point of having both:
//
//   params        a url that does not describe a page. /posts/ tells a
//                 crawler and a cache 404, not 500, so this is notFound().
//   searchParams  the page exists and the query was wrong, which is the
//                 nearest error.tsx — the same place any other bad input goes.

import { NotFoundSignal } from './notFound.js'
import type { ApiPattern } from './routes.js'

/**
 * Standard Schema, restated rather than depended on.
 *
 * It is an interface, and a package for it would be a dependency that ships
 * nothing. Kept to the shape this module reads.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>
    readonly types?: { readonly input: Input; readonly output: Output }
  }
}

interface StandardSchemaResult<Output> {
  readonly value?: Output
  readonly issues?: ReadonlyArray<{
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
  }>
}

/** What a page gets from its own `params` export, already parsed. */
export type ParamsOf<S> = S extends StandardSchemaV1<unknown, infer Out> ? Out : never

/**
 * The props a page with schemas receives.
 *
 * Written as a type rather than generated into a .d.ts because it needs no
 * build step to be correct: the schemas are exports of the same file, so a
 * page can refer to its own.
 *
 *     export const params = z.object({ slug: z.string() })
 *
 *     export default async function Page({ params: p }: PageProps<typeof params>) {
 *       const { slug } = await p   // string, not unknown
 *     }
 */
export interface PageProps<P = never, S = never> {
  params: Promise<[P] extends [never] ? Record<string, string> : ParamsOf<P>>
  searchParams: Promise<[S] extends [never] ? URLSearchParams : ParamsOf<S>>
}

/**
 * The names a pattern binds: `/api/greet/[name]` binds `name`, and
 * `/docs/[...path]` binds `path` — one string, the slashes kept.
 */
type SegmentNames<P extends string> = P extends `${string}[...${infer N}]${infer Rest}`
  ? N | SegmentNames<Rest>
  : P extends `${string}[${infer N}]${infer Rest}`
    ? N | SegmentNames<Rest>
    : never

/** What a route's params resolve to, from its pattern: `{ name: string }`. */
export type ApiParams<P extends string> = { [K in SegmentNames<P>]: string }

/**
 * The second argument of an api route's handler.
 *
 * Every field is a promise, because the engine hands them lazily - a route
 * that never awaits its query string provably does not vary by it, so the
 * build can store one answer - and a sync read of `params.name` has to be a
 * compile error rather than a route that quietly answers 404 to everything.
 *
 * Name the route and the params are typed from its segments; the pattern is
 * checked against the routes the build found, so a typo fails `tsc`:
 *
 *     export async function GET(request: Request, { params }: RouteContext<'/api/greet/[name]'>) {
 *       const { name } = await params   // string
 *     }
 *
 * Or hand it the route's own schemas, the way PageProps takes a page's:
 *
 *     export const params = z.object({ id: z.coerce.number() })
 *     export async function GET(request: Request, { params }: RouteContext<typeof params>) {
 *       const { id } = await params      // number
 *     }
 *
 * With neither, params is the raw segments and searchParams the raw
 * URLSearchParams, still behind a promise.
 */
export interface RouteContext<
  P extends ApiPattern | StandardSchemaV1 = never,
  S extends StandardSchemaV1 = never,
  B extends StandardSchemaV1 = never,
> {
  params: Promise<
    [P] extends [never]
      ? Record<string, string>
      : P extends ApiPattern
        ? ApiParams<P>
        : ParamsOf<P>
  >
  searchParams: Promise<[S] extends [never] ? URLSearchParams : ParamsOf<S>>
  /** Undefined for a method with no body; a promise of the parsed body otherwise. */
  body: [B] extends [never] ? Promise<unknown> | undefined : Promise<ParamsOf<B>>
}

/**
 * A whole handler, typed from the route it answers:
 *
 *     export const GET: RouteHandler<'/api/greet/[name]'> = async (request, { params }) => …
 */
export type RouteHandler<
  P extends ApiPattern | StandardSchemaV1 = never,
  S extends StandardSchemaV1 = never,
  B extends StandardSchemaV1 = never,
> = (
  request: Request,
  context: RouteContext<P, S, B>,
) => Response | Promise<Response>

/**
 * The mark that says a refusal came from a route schema.
 *
 * Symbol.for for the reason every mark in this package is: the app's pages are
 * bundled apart from the engine, so each side gets its own copy of this class
 * and `instanceof` is false between them.
 */
const MARK = Symbol.for('@rsc-kit/core.route-input-error')

/** A query string the page's own schema refused. */
export class SearchParamsError extends Error {
  public readonly errors: Record<string, string[]>

  constructor(errors: Record<string, string[]>) {
    super('The query string is not valid for this page.')
    this.name = 'SearchParamsError'
    this.errors = errors
    ;(this as unknown as Record<symbol, boolean>)[MARK] = true
  }
}

/** Whether this is a refused query string, whichever copy of the class built it. */
export function isSearchParamsError(error: unknown): error is SearchParamsError {
  return (
    typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[MARK] === true
  )
}

/** The field an issue belongs to, joined so a nested one reads as it was named. */
function fieldOf(path: NonNullable<StandardSchemaResult<unknown>['issues']>[number]['path']): string {
  if (!path || path.length === 0) return ''

  return path
    .map((segment) => (typeof segment === 'object' && segment !== null ? segment.key : segment))
    .join('.')
}

function issuesToErrors(
  issues: NonNullable<StandardSchemaResult<unknown>['issues']>,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {}

  for (const issue of issues) {
    ;(errors[fieldOf(issue.path)] ??= []).push(issue.message)
  }

  return errors
}

/**
 * A URLSearchParams as the object a schema expects.
 *
 * A key that appears more than once becomes an array, and one that appears
 * once stays a scalar — so `?tag=a&tag=b` reaches `z.array(z.string())` and
 * `?q=shoes` reaches `z.string()` without the schema having to know which
 * shape the url happened to take.
 */
export function searchParamsToObject(search: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const key of new Set(search.keys())) {
    const all = search.getAll(key)

    out[key] = all.length > 1 ? all : all[0]
  }

  return out
}

/**
 * Run a page's `params` schema, or hand back what the url gave.
 *
 * A refusal is notFound() rather than an error: the route matched a pattern,
 * but the values in it do not describe a page, and 404 is the answer a crawler
 * and a cache both need.
 */
export async function parseParams(
  schema: StandardSchemaV1 | undefined,
  value: Record<string, unknown>,
): Promise<unknown> {
  if (!schema) return value

  const result = await schema['~standard'].validate(value)

  if (result.issues && result.issues.length > 0) {
    // The message is for a log, never a response: it repeats back a piece of
    // the url, and the not-found page is what the visitor sees either way.
    throw new NotFoundSignal(
      'No page for these params: ' +
        Object.entries(issuesToErrors(result.issues))
          .map(([field, messages]) => `${field || 'params'} ${messages[0]}`)
          .join(', '),
    )
  }

  return result.value
}

/**
 * Run a page's `searchParams` schema, or hand back the URLSearchParams.
 *
 * A refusal throws into the nearest error.tsx, which can read `errors` for the
 * fields. The page exists — only the query was wrong — so this is deliberately
 * not a 404.
 */
export async function parseSearchParams(
  schema: StandardSchemaV1 | undefined,
  search: URLSearchParams,
): Promise<unknown> {
  if (!schema) return search

  const result = await schema['~standard'].validate(searchParamsToObject(search))

  if (result.issues && result.issues.length > 0) {
    throw new SearchParamsError(issuesToErrors(result.issues))
  }

  return result.value
}

/**
 * What an api route's schemas turn a request into.
 *
 * Every field is optional and every one is opt-in: a route that exports no
 * schema gets the raw values it always got, and a handler written before any
 * of this existed keeps working untouched.
 */
export interface ApiInput {
  /** Parsed by the route's `params` export, or the raw url segments. */
  params: unknown
  /** Parsed by the route's `searchParams` export, or the URLSearchParams. */
  searchParams: unknown
  /** Parsed by the route's `body` export. Undefined when it declared none. */
  body?: unknown
}

/**
 * Its own mark, not the query string's.
 *
 * Sharing one was a real bug for as long as it took a test to run: both
 * refusals answered the check for a bad query string, whichever was asked
 * first, so every refused body came back 400 instead of 422.
 */
const BODY_MARK = Symbol.for('@rsc-kit/core.body-error')

/** A request body the route's own schema refused. */
export class BodyError extends Error {
  public readonly errors: Record<string, string[]>

  constructor(errors: Record<string, string[]>) {
    super('The request body is not valid.')
    this.name = 'BodyError'
    this.errors = errors
    ;(this as unknown as Record<symbol, boolean>)[BODY_MARK] = true
  }
}

/**
 * Whether this is a refused body, whichever copy of the class built it.
 *
 * The mark rather than instanceof, for the reason every check in this package
 * uses one: an api route is bundled apart from the engine that calls it, so
 * each side has its own copy of this class and instanceof is false between
 * them — the refusal would surface as an unhandled 500.
 */
export function isBodyError(error: unknown): error is BodyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<symbol, unknown>)[BODY_MARK] === true
  )
}

/**
 * Run a route's `body` schema against whatever the request carries.
 *
 * JSON and form encodings both, because an api route answers a url and a url
 * is posted to by both. Anything else is handed to the schema as the raw text,
 * which is the only honest thing to do with a body this does not understand.
 */
export async function parseBody(
  schema: StandardSchemaV1 | undefined,
  request: Request,
): Promise<unknown> {
  if (!schema) return undefined

  const type = request.headers.get('Content-Type') ?? ''
  let raw: unknown

  try {
    if (type.includes('json')) {
      raw = await request.json()
    } else if (type.includes('form')) {
      raw = searchParamsToObject(new URLSearchParams(await request.text()))
    } else {
      raw = await request.text()
    }
  } catch {
    // Malformed json is a refusal about the body as a whole rather than any
    // field, which is the empty-string key the form errors already use.
    throw new BodyError({ '': ['The request body could not be read.'] })
  }

  const result = await schema['~standard'].validate(raw)

  if (result.issues && result.issues.length > 0) {
    throw new BodyError(issuesToErrors(result.issues))
  }

  return result.value
}
