// Freezing an api route the way a page is frozen.
//
// Not as an opt-in flag, deliberately. A page is stored by default and opts
// OUT by touching the request — connection(), cookies(), headers() all suspend
// at build time because there is no request there, and that is what marks the
// page dynamic. A route works the same way and for the same reason: one model
// to learn rather than two, and the honest default in both cases is "the build
// tried, and here is what it found".
//
// GET only. Everything else is a method a caller may not repeat, and a stored
// answer to a POST is a stored answer to something that was supposed to happen
// once.

import { pathKey } from './prerender.js'
import { UNPROBED, requestReadBy, withRequest, withResponseDraft } from './request.js'
import { watchNondeterminism, whileRendering } from './nondeterminism.js'
import type { ManifestApiRoute, RouteManifest } from './manifest.js'
import { allowFor } from './routing.js'

/**
 * How long a route gets to answer before it is called dynamic.
 *
 * A route that reads the request does not fail here — it never settles, because
 * the accessors suspend forever with no request to read. So the budget is what
 * turns "waiting" into an answer, and it only has to be long enough for a route
 * that was going to finish.
 */
const BUDGET_MS = 2_000

/** What a stored answer holds. Enough to rebuild the Response exactly. */
export interface FrozenApiResponse {
  status: number
  headers: [string, string][]
  body: string
  /**
   * Whether the answer depends on the query string.
   *
   * False when the handler never awaited `searchParams` and declared no schema
   * for it, which means the same answer is right for `?utm_source=anything`.
   * True and the stored answer is only good for the bare url.
   */
  varies: boolean
}

/** The file a frozen route is stored as. */
export function apiKey(url: string): string {
  return `${pathKey(url)}.api.json`
}

/**
 * Reading anything here means the answer depends on the caller.
 *
 * `url` is on the list although the path is the key the answer is stored
 * under, because nobody reads it for the path: a handler written the Next way
 * reads `new URL(request.url).searchParams`, which the probe cannot see the
 * way it sees the awaited `searchParams` — and a stored answer marked as
 * varying with nothing would then be served to every query, a webhook's
 * verification handshake included. Reading the url also puts the build
 * machine's origin within reach of the answer. A route that wants the bare
 * url stored awaits `searchParams` instead; the table says so.
 */
const PER_CALLER = new Set([
  'url',
  'headers',
  'body',
  'bodyUsed',
  'text',
  'json',
  'formData',
  'arrayBuffer',
  'blob',
  'bytes',
  'signal',
  'referrer',
  'credentials',
])

/**
 * A Request that records what was read out of it.
 *
 * A proxy rather than a subclass because the interesting properties are
 * getters on Request.prototype, and `this` has to stay the real Request or
 * every one of them throws about an illegal invocation.
 */
function probeRequest(url: string, touched: Set<string>): Request {
  const real = new Request(url, { method: 'GET' })

  return new Proxy(real, {
    get(target, property) {
      // The engine's own way past the probe, for the url read that resolves
      // the awaited searchParams - booked to searchParams, not to url.
      if (property === UNPROBED) return target
      if (typeof property === 'string' && PER_CALLER.has(property)) touched.add(property)

      const value = Reflect.get(target, property, target)

      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** The url a route with no parameters answers. */
function urlFor(route: ManifestApiRoute): string | null {
  // A parameterised route has as many urls as there are values, and nothing
  // here knows them. Pages solve this with generateStaticParams; until a route
  // can say the same, one is answered per request.
  if (route.segments.some((segment) => segment.type !== 'static')) return null

  return '/' + route.segments.map((segment) => segment.value).join('/')
}

/**
 * What the build calls a route in its output.
 *
 * The pattern for a parameterised one, spelled the way pages already spell
 * theirs, rather than the module name — a line reading
 * "/app/api/greet/[name]/route" names a file on disk and the rest of the table
 * names urls.
 */
function labelFor(route: ManifestApiRoute): string {
  return (
    '/' +
    route.segments
      .map((segment) => (segment.type === 'static' ? segment.value : `_${segment.value}_`))
      .join('/')
  )
}

/** Whether a body is text this can store and hand back unchanged. */
function asText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)

    return text
  } catch {
    // Binary. Storable in principle, as base64, at the cost of a third of its
    // size on disk and a decode per request — for a route that is far more
    // likely to be streaming a file it should be serving as a file.
    return null
  }
}

export interface ApiPrerenderResult {
  url: string
  name: string
  type: 'frozen' | 'dynamic'
  reason: string | null
  /** Stored, and worth a second look - it froze a value that will not be the same tomorrow. */
  warning?: string
}

/**
 * Try to answer every api route once, at build time, and store what can be.
 *
 * Sequential rather than parallel: there are usually few of them, each is a
 * function call rather than a React render, and the ones that are going to be
 * dynamic spend the whole budget waiting — which is time, not work.
 */
export async function prerenderApiRoutes(
  engine: { handleApiRoute?: (n: string, r: Request, p: Record<string, string>, a: string) => Promise<Response> },
  manifest: RouteManifest,
  write: (name: string, contents: string) => Promise<void>,
): Promise<ApiPrerenderResult[]> {
  if (!engine.handleApiRoute || !manifest.apis?.length) return []

  const results: ApiPrerenderResult[] = []

  // Date.now() and friends are watched for the length of the loop, the way
  // the page prerender watches them; whileRendering records what each route
  // reached for while it answered.
  const unwatch = watchNondeterminism()

  try {
  for (const route of manifest.apis) {
    const said = (type: 'frozen' | 'dynamic', reason: string | null) => {
      results.push({ url: labelFor(route), name: route.name, type, reason })
    }

    if (!route.methods.includes('GET')) {
      said('dynamic', 'no GET to store')
      continue
    }

    // A guarded route answers differently depending on who is asking, which is
    // the whole purpose of the guard. Storing one answer and serving it to
    // everyone is how a guard is silently removed.
    if (route.middleware.length > 0 || (route.hostMiddleware?.length ?? 0) > 0) {
      said('dynamic', 'guarded by middleware')
      continue
    }

    const url = urlFor(route)

    if (!url) {
      said('dynamic', 'one url per param value, and none are listed')
      continue
    }

    const touched = new Set<string>()
    const request = probeRequest('https://prerender.invalid' + url, touched)

    // No request in scope, so headers(), cookies() and connection() suspend
    // forever rather than resolving to whatever the build machine had. The
    // budget below is what turns that into an answer.
    // Inside a response draft, because that is where the engine puts a cookie
    // a route sets - a literal Set-Cookie on its Response is moved there too
    // whenever a draft is open - and a probe with no draft reads a Response
    // the cookie may already have left. Whether it went to the draft or stayed
    // on the Response depends on what else is running in the process; the
    // question here is only whether there was one.
    const answered = await withResponseDraft(({ taken }) =>
      withRequest(null as never, async () => {
        let readBy: string[] = []

        const response = await Promise.race([
          whileRendering(() => engine.handleApiRoute!(route.name, request, {}, allowFor(route)))
            .then(([value, reached]) => ({ value, reached }))
            .catch((error) => ({ error })),
          new Promise<null>((resolve) =>
            setTimeout(() => {
              readBy = requestReadBy()
              resolve(null)
            }, BUDGET_MS),
          ),
        ])

        return { response, readBy: readBy.length ? readBy : requestReadBy(), drafted: taken() }
      }),
    )

    if (answered.response === null) {
      const why = answered.readBy.length
        ? 'dynamic — called ' + answered.readBy.join(', ')
        : 'did not answer within the build budget'

      said('dynamic', why)
      continue
    }

    if ('error' in answered.response) {
      // Not a build failure. A route that throws with no request may be doing
      // exactly the right thing — refusing a caller it cannot identify — and
      // refusing the build over it would make that route unbuildable.
      said('dynamic', 'threw without a request')
      continue
    }

    if (touched.size > 0) {
      const hint = touched.has('url') ? ' (await searchParams to read the query and keep the bare url stored)' : ''

      said('dynamic', 'reads the request — ' + [...touched].sort().join(', ') + hint)
      continue
    }

    // Awaiting the query string is not a reason to give up on the route — the
    // bare url still has one right answer. It only narrows which requests the
    // stored answer is good for.
    const varies = answered.readBy.includes('searchParams')

    const response = answered.response.value

    // A refusal is an answer to the request the build sent - none - not to
    // the ones visitors will. A route that answers 403 with nothing read is
    // usually checking something the probe cannot see, and a stored 403 was
    // once every webhook handshake's answer. Left to run, and said so.
    if (response.status >= 400) {
      said('dynamic', `answered ${response.status} to the build — a refusal is not an answer to store`)
      continue
    }

    // A cookie is an answer for one visitor, whatever the route read to
    // decide on it. Stored, the build's cookie would be handed to everyone.
    if (response.headers.has('set-cookie') || answered.drafted.has('set-cookie')) {
      said('dynamic', 'sets a cookie — an answer for one visitor, not one to store')
      continue
    }

    const body = asText(new Uint8Array(await response.arrayBuffer()))

    if (body === null) {
      said('dynamic', 'answers with bytes rather than text')
      continue
    }

    await write(
      apiKey(url),
      JSON.stringify({
        status: response.status,
        // Lower-cased and sorted, so two builds of the same route produce the
        // same bytes. Headers iteration does not promise a case or an order,
        // and a file that differs between builds for no reason defeats
        // content-addressed caching and makes a diff unreadable. Names are
        // case-insensitive, so nothing is lost by picking one.
        headers: [...response.headers]
          .map(([name, value]) => [name.toLowerCase(), value] as [string, string])
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        body,
        varies,
      } satisfies FrozenApiResponse),
    )

    said('frozen', varies ? 'stored for the bare url — it reads the query string' : null)

    // The same warning a page gets: a stored answer keeps whatever Date.now()
    // or Math.random() returned at build time, and a json body has no browser
    // to move it to.
    const reached = answered.response.reached

    if (reached.length > 0) {
      results[results.length - 1]!.warning =
        `froze ${reached.join(' and ')}${route.source ? ' in ' + route.source : ''} — a stored answer keeps whatever that returned at build time. ` +
        'If it should differ per call, read the request (await connection()) so the route runs on demand.'
    }
  }
  } finally {
    unwatch()
  }

  return results
}
