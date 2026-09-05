/**
 * An edge worker that serves a PPR shell from cache and has the origin finish
 * it, into the same response.
 *
 * No KV, no build-time push, no CI step. The cache populates itself from the
 * origin's own shell endpoint, and one deployment serves every app behind it.
 *
 * The visitor's first byte is the shell, out of the edge cache. The holes
 * arrive behind it and are placed by React's own inline script, so they land
 * whether or not the page's JavaScript ever loads.
 */

interface Env {
  ORIGIN: string
}

const SHELL = '/_rsc/ppr-shell'
const RESUME = '/_rsc/ppr-resume'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Only ever a plain document request. A payload fetch, an action POST and
    // an asset all belong to the origin untouched.
    if (request.method !== 'GET' || request.headers.get('X-RSC') !== null) {
      return fetch(originUrl(env, url), request)
    }

    const cache = caches.default
    const shellKey = new Request(`${env.ORIGIN}${SHELL}?url=${encodeURIComponent(url.pathname)}`)
    const cached = await cache.match(shellKey)

    // Nothing cached yet. The visitor is not made to wait for the cache to
    // fill — they go to the origin, and the shell warms behind them. No
    // request is ever slower for this worker being here.
    if (!cached) {
      ctx.waitUntil(warm(cache, shellKey))

      return fetch(originUrl(env, url), request)
    }

    const { shell } = (await cached.json()) as { shell: string }

    // The visitor's own request, forwarded. The origin runs this route's
    // middleware against these cookies — so a guarded page is refused here
    // exactly as it would be at the origin, and this worker cannot be used to
    // walk around a guard.
    const resumed = await fetch(`${env.ORIGIN}${RESUME}?url=${encodeURIComponent(url.pathname)}`, {
      method: 'POST',
      headers: request.headers,
    })

    // The origin declined, redirected, or the build moved on. Drop the shell
    // and let the visitor have a whole page from the origin rather than a
    // half-finished one.
    if (!resumed.ok) {
      ctx.waitUntil(cache.delete(shellKey))

      return fetch(originUrl(env, url), request)
    }

    const encoder = new TextEncoder()

    const body = new ReadableStream({
      async start(controller) {
        // The shell first, immediately: this is the byte the visitor waited for.
        controller.enqueue(encoder.encode(shell))

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

function originUrl(env: Env, url: URL): string {
  return `${env.ORIGIN}${url.pathname}${url.search}`
}

/**
 * Fill the cache from the origin's shell endpoint.
 *
 * The endpoint answers 404 for a route with middleware, so a guarded page
 * never becomes a cache entry — it is refused at the source rather than
 * guarded here, which is one fewer place to get it wrong.
 */
async function warm(cache: Cache, key: Request): Promise<void> {
  const response = await fetch(key)

  if (response.ok) await cache.put(key, response.clone())
}
