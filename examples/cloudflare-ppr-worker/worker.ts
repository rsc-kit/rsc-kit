/**
 * An edge worker that serves a PPR shell from cache and has the origin finish
 * it, into the same response - over the PPR contract, which is the only way an
 * rsc-kit origin hands out a shell. Any framework that implements the
 * contract works behind it; nothing here is rsc-kit's.
 *
 * No KV, no build-time push, no CI step. The cache populates itself from the
 * origin's shell endpoint. The one thing it shares with the origin is the
 * token: set the same PPR_TOKEN on both, and the endpoints answer it alone.
 *
 * The visitor's first byte is the shell, out of the edge cache. The holes
 * arrive behind it and are placed by a small inline script React emits beside
 * them — which runs as the HTML parses, so the content appears without waiting
 * for the app bundle to download or for React to hydrate. It is still
 * JavaScript: with scripting disabled the segments stay hidden and the
 * fallbacks remain.
 */

interface Env {
  /** An ordinary origin over HTTP. */
  ORIGIN?: string
  /**
   * Or a service binding, which is required when the origin is itself a Worker
   * on this account: Cloudflare refuses a plain fetch between two of them with
   * `error code: 1042`, and the body it returns is a 20 kB HTML error page that
   * looks enough like a real response to be mistaken for one.
   */
  ORIGIN_SERVICE?: { fetch: (request: Request) => Promise<Response> }
  /** The same secret the origin has. Without it the origin answers 404. */
  PPR_TOKEN: string
  /**
   * Optional: the build's `.output/ppr.json`, as it is. With it, only the
   * pages it lists are looked up, its `bypass` is honoured, and a shell from
   * another build is never served. Without it, every document request is
   * looked up, and a page with no shell costs one background request to find
   * out.
   */
  PPR_MARKER?: string
}

interface Marker {
  v: 1
  build: string
  shells: string[]
  bypass?: { headers?: string[]; query?: string[]; cookies?: string[] }
}

interface Shell {
  build: string
  html: string
  state: string
}

const SHELL = '/_ppr/shell'
const RESUME = '/_ppr/resume'

/** What a shell cannot depend on, so a url carrying only these may have one. */
const CAMPAIGN = /^(utm_.+|gclid|fbclid|msclkid|dclid|gbraid|wbraid|mc_cid|mc_eid)$/

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // The contract's endpoints are the edge's to call, never a visitor's.
    if (url.pathname.startsWith('/_ppr/')) return new Response('Not found', { status: 404 })

    const marker = markerOf(env)
    const path = decoded(url.pathname)

    if (
      path === null ||
      !servable(request, url, marker) ||
      (marker !== null && !marker.shells.some((pattern) => matches(pattern, path)))
    ) {
      return call(env, `${url.pathname}${url.search}`, request)
    }

    const cache = caches.default
    // Per path, never per pattern: /docs/a and /docs/b may have their own.
    const shellKey = new Request(`${base(env)}${SHELL}?path=${encodeURIComponent(path)}`)
    const cached = await cache.match(shellKey)

    // Nothing cached yet. The visitor is not made to wait for the cache to
    // fill — they go to the origin, and the shell warms behind them. No
    // request is ever slower for this worker being here.
    if (!cached) {
      ctx.waitUntil(warm(env, cache, shellKey, path))

      return call(env, `${url.pathname}${url.search}`, request)
    }

    const shell = (await cached.json()) as Shell

    // From another build than the one deployed: never served.
    if (marker && shell.build !== marker.build) {
      ctx.waitUntil(cache.delete(shellKey))

      return call(env, `${url.pathname}${url.search}`, request)
    }

    const encoder = new TextEncoder()

    // The shell goes out BEFORE the origin is asked anything.
    //
    // The first version awaited the resume so it could turn a guard refusal
    // into a redirect. That cost the entire point of the worker: it added a
    // round trip to the origin instead of removing one, and measured slower
    // than talking to the origin directly — 63ms against 55ms.
    //
    // There is no verdict to wait for. A cached shell exists only for a page
    // the shell endpoint agreed to serve, and it refuses any page with a
    // guard — so a page reached here has no guard to fail.
    //
    // And the holes have a backstop either way: the client fetches this page's
    // payload as part of hydrating, so a resume that never arrives leaves the
    // boundaries to be filled the way they were before any of this existed.
    // Sending the shell early risks a slower hole, never a wrong page.
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(shell.html))

        const resumed = await resume(env, request, `${path}${url.search}`, shell)

        // A deploy happened since this shell was cached. A stale shell does
        // NOT make the resume fail — it replays against slots that have since
        // moved, React reports a tree mismatch and falls back to client
        // rendering. Evict so the next visitor gets a current one; this one
        // still gets their holes from the client.
        if (
          !resumed.ok ||
          !(resumed.headers.get('Content-Type') ?? '').startsWith('text/html') ||
          resumed.headers.get('PPR-Build') !== shell.build
        ) {
          ctx.waitUntil(cache.delete(shellKey))

          return controller.close()
        }

        const reader = resumed.body!.getReader()

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) break

            controller.enqueue(value)
          }
        } finally {
          controller.close()
        }
      },
    })

    return new Response(request.method === 'HEAD' ? null : body, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // The shell was cacheable; this response is not. It carries the holes,
        // which were rendered for this visitor.
        'Cache-Control': 'private, no-store',
      },
    })
  },
}

/**
 * Whether this is a visitor's document load a shell can answer: a GET for
 * html, not a range, not one of the framework's own requests on the page's
 * path (its `bypass`), and no query the shell could depend on.
 */
function servable(request: Request, url: URL, marker: Marker | null): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (!(request.headers.get('Accept') ?? '').includes('text/html')) return false
  if (request.headers.has('Range')) return false

  const dest = request.headers.get('Sec-Fetch-Dest')

  if (dest && dest !== 'document') return false

  // Without a marker, rsc-kit's own: every payload fetch carries X-RSC.
  const bypass = marker?.bypass ?? { headers: ['X-RSC'] }
  const cookies = (request.headers.get('Cookie') ?? '').split(/;\s*/)

  if (bypass.headers?.some((name) => request.headers.has(name))) return false
  if (bypass.query?.some((name) => url.searchParams.has(name))) return false
  if (bypass.cookies?.some((name) => cookies.some((cookie) => cookie.startsWith(`${name}=`)))) return false

  return [...url.searchParams.keys()].every((key) => CAMPAIGN.test(key))
}

/** A marker path against a request's: `[name]` is one segment, a final `[...name]` one or more. */
function matches(pattern: string, path: string): boolean {
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

function markerOf(env: Env): Marker | null {
  if (!env.PPR_MARKER) return null

  const marker = JSON.parse(env.PPR_MARKER) as Marker

  return marker.v === 1 ? marker : null
}

function decoded(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

/** A stable base for cache keys. A service binding has no url of its own. */
function base(env: Env): string {
  return env.ORIGIN ?? 'https://origin.invalid'
}

/**
 * One call to the origin, over whichever route this deployment has.
 *
 * Host is deliberately dropped. `fetch(otherUrl, request)` looks like the
 * obvious way to forward and is wrong: the incoming Request carries
 * `Host: <this worker>`, Cloudflare routes on that rather than on the url, and
 * the answer is its own 404 page — 20 kB of plausible HTML, no error anywhere.
 *
 * And no PPR-* header a visitor sent goes with it: those are the edge's.
 */
function call(
  env: Env,
  path: string,
  request: Request,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const headers = new Headers(request.headers)

  headers.delete('host')

  for (const name of [...headers.keys()]) if (name.startsWith('ppr-')) headers.delete(name)
  for (const [name, value] of Object.entries(init.headers ?? {})) headers.set(name, value)

  const method = init.method ?? request.method

  const outbound = new Request(`${base(env)}${path}`, {
    method,
    headers,
    body: init.body ?? (method === 'GET' || method === 'HEAD' ? undefined : request.body),
  })

  return env.ORIGIN_SERVICE ? env.ORIGIN_SERVICE.fetch(outbound) : fetch(outbound)
}

/**
 * The holes, for this visitor: their cookies and headers, so the origin
 * renders for them and runs whatever it would for the document, and their
 * query, which a hole may read. Plain bytes, since they follow the shell's.
 */
function resume(env: Env, request: Request, href: string, shell: Shell): Promise<Response> {
  return call(env, `${RESUME}?url=${encodeURIComponent(href)}`, request, {
    method: 'POST',
    headers: {
      'PPR-Token': env.PPR_TOKEN,
      'PPR-Build': shell.build,
      'Accept-Encoding': 'identity',
      'Content-Type': 'application/octet-stream',
    },
    body: shell.state,
  })
}

/**
 * Fill the cache from the origin's shell endpoint.
 *
 * The endpoint answers 404 for a page with a guard, so a guarded page never
 * becomes a cache entry — it is refused at the source rather than guarded
 * here, which is one fewer place to get it wrong. Its answer says no-store,
 * because it was given for the token; this worker keeps it on purpose, in a
 * cache only it reads, under a lifetime of its own.
 */
async function warm(env: Env, cache: Cache, key: Request, path: string): Promise<void> {
  const ask = new Request(`${base(env)}${SHELL}?path=${encodeURIComponent(path)}`, {
    headers: { 'PPR-Token': env.PPR_TOKEN, Accept: 'application/json' },
  })
  const response = env.ORIGIN_SERVICE ? await env.ORIGIN_SERVICE.fetch(ask) : await fetch(ask)

  if (!response.ok) return

  const { build, html, state } = (await response.json()) as Shell

  await cache.put(
    key,
    new Response(JSON.stringify({ build, html, state }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    }),
  )
}
