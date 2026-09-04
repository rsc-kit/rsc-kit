/**
 * Dev-only rewriting of Vite's internal URLs onto the dev server's origin.
 *
 * In dev, @vitejs/plugin-rsc emits its bootstrap and CSS links root-relative —
 * `/@id/...`, `/@fs/...`. It builds them as `config.base + url`, and Vite
 * collapses an absolute `base` to `/` during dev, so neither `base` nor
 * `server.origin` (the mechanism laravel-vite-plugin relies on) can move them.
 *
 * The host serves the page, so root-relative sends the browser to PHP for
 * modules only Vite can answer. Rewriting them here keeps the app on its
 * normal development URL while assets come from the dev server, which is the
 * arrangement Laravel developers already expect from Vite.
 *
 * Only these four prefixes are rewritten. A blanket `/@` rule would also catch
 * ordinary page text, and this runs over rendered HTML.
 */
const VITE_PREFIXES = ['/@id/', '/@fs/', '/@vite/', '/@react-refresh']

/** Longest tail that could hide a split prefix across a chunk boundary. */
const CARRY = Math.max(...VITE_PREFIXES.map((p) => p.length)) + 1

export function rewriteViteDevUrls(html: string, origin: string): string {
  let out = html
  for (const prefix of VITE_PREFIXES) {
    // Anchored on the opening quote so only URL positions match, never text
    // that happens to contain the same characters.
    out = out.split('"' + prefix).join('"' + origin + prefix)
    out = out.split("'" + prefix).join("'" + origin + prefix)
  }
  return out
}

/**
 * The same rewrite over a stream. A URL can straddle a chunk boundary, so the
 * last few bytes are held back rather than emitted, and flushed at the end.
 *
 * Built from a reader rather than `pipeThrough(new TransformStream(...))`: the
 * test suites share a process with happy-dom, which replaces the stream
 * globals, and a foreign TransformStream is rejected by a native stream.
 */
export function rewriteViteDevUrlStream(stream: ReadableStream, origin: string): ReadableStream {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const reader = stream.getReader()
  let carry = ''

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          if (carry) controller.enqueue(encoder.encode(rewriteViteDevUrls(carry, origin)))
          controller.close()
          return
        }

        const text = carry + decoder.decode(value, { stream: true })
        // Hold back a possible partial prefix; emit everything before it.
        const keep = Math.max(0, text.length - CARRY)
        carry = text.slice(keep)

        if (keep > 0) {
          controller.enqueue(encoder.encode(rewriteViteDevUrls(text.slice(0, keep), origin)))
          return
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}
