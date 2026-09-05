import { describe, expect, test } from 'bun:test'
import { rewriteViteDevUrls, rewriteViteDevUrlStream } from '../../src/devUrls'

const ORIGIN = 'http://localhost:5173'

function streamOf(chunks: string[]): ReadableStream {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
}

// Read manually rather than through Response: happy-dom replaces the stream
// globals for the whole process, so mixing implementations here is what the
// production code deliberately avoids too.
async function rewritten(chunks: string[]): Promise<string> {
  const reader = rewriteViteDevUrlStream(streamOf(chunks), ORIGIN).getReader()
  const decoder = new TextDecoder()
  let out = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) return out
    out += decoder.decode(value, { stream: true })
  }
}

describe('dev URL rewriting', () => {
  test('points the bootstrap import at the dev server', () => {
    // Root-relative, this asks the host for a module only Vite can answer.
    expect(rewriteViteDevUrls('import("/@id/__x00__virtual:vite-rsc/entry-browser")', ORIGIN)).toBe(
      `import("${ORIGIN}/@id/__x00__virtual:vite-rsc/entry-browser")`,
    )
  })

  test('points CSS links at the dev server', () => {
    expect(rewriteViteDevUrls('<link rel="stylesheet" href="/@fs/app/styles.css">', ORIGIN)).toBe(
      `<link rel="stylesheet" href="${ORIGIN}/@fs/app/styles.css">`,
    )
  })

  test('leaves page content that merely looks like a vite URL alone', () => {
    // The rewrite runs over rendered HTML, so it must be anchored on the quote
    // that opens an attribute rather than matching the prefix anywhere.
    const prose = '<p>Vite serves modules from /@fs/ during development.</p>'
    expect(rewriteViteDevUrls(prose, ORIGIN)).toBe(prose)
  })

  test('leaves the host’s own routes alone', () => {
    const html = '<a href="/docs/rsc">RSC</a><script src="/js/app.js"></script>'
    expect(rewriteViteDevUrls(html, ORIGIN)).toBe(html)
  })

  test('rewrites a URL split across two chunks', async () => {
    // React streams; a URL has no reason to land inside one chunk. Getting this
    // wrong emits a half-rewritten URL that 404s against the host.
    expect(await rewritten(['<link href="/@f', 's/app/styles.css">'])).toBe(
      `<link href="${ORIGIN}/@fs/app/styles.css">`,
    )
  })

  test('rewrites a URL split one character at a time', async () => {
    const html = '<link href="/@fs/a.css">'
    expect(await rewritten([...html])).toBe(`<link href="${ORIGIN}/@fs/a.css">`)
  })

  test('emits the tail when the stream ends mid-prefix', async () => {
    // The held-back carry must still be flushed, or output is truncated.
    expect(await rewritten(['<p>done</p>'])).toBe('<p>done</p>')
  })

  test('preserves multi-byte characters across chunk boundaries', async () => {
    expect(await rewritten(['<p>café ', '— done</p>'])).toBe('<p>café — done</p>')
  })
})
