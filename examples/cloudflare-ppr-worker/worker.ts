/**
 * An edge worker that serves a PPR shell from cache and has the origin finish
 * it, into the same response.
 *
 * No KV, no build-time push, no CI step. The cache populates itself from the
 * origin's own shell endpoint, and one deployment serves every app behind it.
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
}

const SHELL = '/_rsc/ppr-shell'
const RESUME = '/_rsc/ppr-resume'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Only ever a plain document request. A payload fetch, an action POST and
    // an asset all belong to the origin untouched.
    if (request.method !== 'GET' || request.headers.get('X-RSC') !== null) {
      return call(env, `${url.pathname}${url.search}`, request)
    }

    const cache = caches.default
    const shellKey = new Request(`${base(env)}${SHELL}?url=${encodeURIComponent(url.pathname)}`)
    const cached = await cache.match(shellKey)

    // Nothing cached yet. The visitor is not made to wait for the cache to
    // fill — they go to the origin, and the shell warms behind them. No
    // request is ever slower for this worker being here.
    if (!cached) {
      ctx.waitUntil(warm(env, cache, shellKey, url.pathname))

      return call(env, `${url.pathname}${url.search}`, request)
    }

    const { shell, version } = (await cached.json()) as { shell: string; version: string | null }

    const encoder = new TextEncoder()

    // The shell goes out BEFORE the origin is asked anything.
    //
    // The first version awaited the resume so it could turn a guard refusal
    // into a redirect. That cost the entire point of the worker: it added a
    // round trip to the origin instead of removing one, and measured slower
    // than talking to the origin directly — 63ms against 55ms.
    //
    // There is no verdict to wait for. A cached shell exists only for a route
    // the shell endpoint agreed to serve, and it refuses any route that
    // declares middleware — so a page reached here has no guard to fail.
    //
    // And the holes have a backstop either way: the client fetches this page's
    // payload as part of hydrating, so a resume that never arrives leaves the
    // boundaries to be filled the way they were before any of this existed.
    // Sending the shell early risks a slower hole, never a wrong page.
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(shell))

        const resumed = await call(
          env,
          `${RESUME}?url=${encodeURIComponent(url.pathname)}`,
          request,
          'POST',
        )

        // A deploy happened since this shell was cached. A stale shell does NOT
        // make the resume fail — it replays against slots that have since
        // moved, React reports a tree mismatch and falls back to client
        // rendering. Evict so the next visitor gets a current one; this one
        // still gets their holes from the client.
        const current = resumed.headers.get('X-RSC-Version')

        if (!resumed.ok || (version && current && version !== current)) {
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

    return new Response(body, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // The shell was cacheable; this response is not. It carries the holes,
        // which were rendered for this visitor.
        'Cache-Control': 'private, no-store',
      },
    })
  },
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
 */
function call(env: Env, path: string, request: Request, method?: string): Promise<Response> {
  const headers = new Headers(request.headers)

  headers.delete('host')

  const outbound = new Request(`${base(env)}${path}`, {
    method: method ?? request.method,
    headers,
    body:
      (method ?? request.method) === 'GET' || (method ?? request.method) === 'HEAD'
        ? undefined
        : request.body,
  })

  return env.ORIGIN_SERVICE ? env.ORIGIN_SERVICE.fetch(outbound) : fetch(outbound)
}

/**
 * Fill the cache from the origin's shell endpoint.
 *
 * The endpoint answers 404 for a route with middleware, so a guarded page
 * never becomes a cache entry — it is refused at the source rather than
 * guarded here, which is one fewer place to get it wrong.
 */
async function warm(env: Env, cache: Cache, key: Request, pathname: string): Promise<void> {
  const response = env.ORIGIN_SERVICE
    ? await env.ORIGIN_SERVICE.fetch(new Request(key.url))
    : await fetch(key)

  if (response.ok) await cache.put(key, response.clone())
}
