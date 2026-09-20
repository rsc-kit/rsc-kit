// gzip for what the host answers, where nothing in front of it will.
//
// The rules: only for a request that accepts it, only for text-shaped
// answers big enough to matter, never over something already encoded or
// marked no-transform, never a HEAD or a 204. A stream stays a stream: every
// chunk is flushed through, so a shell reaches the browser before the holes
// have filled. A stored answer is compressed once and kept.

import { describe, expect, test } from 'bun:test'
import { gunzipSync } from 'node:zlib'
import { compressed, forgetCompressed, shouldCompress } from '../../src/compress'
import { createRscHandler } from '../../src/host'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('compress.test.ts')

const accepting = (url = 'https://x.test/', init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { 'accept-encoding': 'gzip, deflate, br', ...(init.headers as Record<string, string>) } })

const html = (size = 4096, headers: Record<string, string> = {}) =>
  new Response('<p>' + 'x'.repeat(size) + '</p>', { headers: { 'content-type': 'text/html', ...headers } })

describe('what is compressed', () => {
  test('a text answer, for a request that accepts gzip', () => {
    expect(shouldCompress(accepting(), html())).toBe(true)
    expect(shouldCompress(new Request('https://x.test/'), html())).toBe(false)
    expect(shouldCompress(accepting(), new Response('x', { headers: { 'content-type': 'text/x-component' } }))).toBe(true)
  })

  test('not an image, a HEAD, a 204, an already-encoded answer, or a no-transform one', () => {
    expect(shouldCompress(accepting(), new Response('x', { headers: { 'content-type': 'image/png' } }))).toBe(false)
    expect(shouldCompress(accepting('https://x.test/', { method: 'HEAD' }), html())).toBe(false)
    expect(shouldCompress(accepting(), new Response(null, { status: 204 }))).toBe(false)
    expect(shouldCompress(accepting(), html(4096, { 'content-encoding': 'br' }))).toBe(false)
    expect(shouldCompress(accepting(), html(4096, { 'cache-control': 'no-transform' }))).toBe(false)
  })

  test('not something too small to be worth a frame', () => {
    expect(shouldCompress(accepting(), html(10, { 'content-length': '17' }))).toBe(false)
  })
})

describe('the compressed answer', () => {
  test('carries the encoding, drops the length, varies on Accept-Encoding, and decodes to the original', async () => {
    const body = '<p>' + 'hello '.repeat(1000) + '</p>'
    const answer = await compressed(
      accepting(),
      new Response(body, { headers: { 'content-type': 'text/html', 'content-length': String(body.length), vary: 'X-RSC' } }),
    )

    expect(answer.headers.get('content-encoding')).toBe('gzip')
    expect(answer.headers.get('content-length')).toBeNull()
    expect(answer.headers.get('vary')).toBe('X-RSC, Accept-Encoding')

    const bytes = new Uint8Array(await answer.arrayBuffer())

    expect(bytes.length).toBeLessThan(body.length / 10)
    expect(gunzipSync(bytes).toString()).toBe(body)
  })

  test('a stream is flushed chunk by chunk: the shell arrives before the rest is written', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const encoder = new TextEncoder()
    const shell = '<html><body>' + 'shell '.repeat(500)
    const rest = 'late '.repeat(500) + '</body></html>'
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(shell))
        await gate
        controller.enqueue(encoder.encode(rest))
        controller.close()
      },
    })
    const answer = await compressed(accepting(), new Response(body, { headers: { 'content-type': 'text/html' } }))
    const reader = answer.body!.getReader()

    // Before the gate opens, compressed bytes for the shell are already out.
    const chunks: Uint8Array[] = []
    const first = await Promise.race([
      reader.read().then((r) => {
        if (r.value) chunks.push(r.value)

        return r.value?.length ?? 0
      }),
      new Promise<number>((resolve) => setTimeout(() => resolve(-1), 500)),
    ])

    expect(first).toBeGreaterThan(0)

    release()

    for (;;) {
      const { done, value } = await reader.read()

      if (done) break

      chunks.push(value)
    }

    // Reassembled, it is the whole page.
    expect(gunzipSync(Buffer.concat(chunks.map((c) => Buffer.from(c)))).toString()).toBe(shell + rest)
  })

  test('a stored answer is compressed once and reused', async () => {
    forgetCompressed()

    const body = 'stored '.repeat(1000)
    const first = await compressed(accepting(), new Response(body, { headers: { 'content-type': 'text/html' } }), 'v1\n/')
    const second = await compressed(accepting(), new Response('DIFFERENT ' + body, { headers: { 'content-type': 'text/html' } }), 'v1\n/')

    // The second answer for the same key is the first's bytes: stored means
    // the same bytes for everyone, and the key carries the build.
    expect(await second.text()).toBe(await first.text())
    expect(gunzipSync(new Uint8Array(await (await compressed(accepting(), new Response(body, { headers: { 'content-type': 'text/html' } }), 'v1\n/')).arrayBuffer())).toString()).toBe(body)
  })
})

describe('through the host', () => {
  const manifest = {
    version: 'b1',
    routes: [],
    intercepts: [],
    apis: [{ name: 'app/api/big/route', segments: [{ type: 'static', value: 'api' }, { type: 'static', value: 'big' }], methods: ['GET'], middleware: [] }],
  }
  const engine = {
    manifest: () => manifest,
    installHostFn: () => () => {},
    async handleApiRoute() {
      return Response.json({ rows: Array.from({ length: 500 }, (_, i) => ({ i, name: 'row ' + i })) })
    },
  }

  test('an api route answers gzipped to a request that accepts it, raw otherwise', async () => {
    const handle = createRscHandler({ engine: engine as never })
    const zipped = await handle(accepting('https://x.test/api/big'))
    const raw = await handle(new Request('https://x.test/api/big'))

    expect(zipped!.headers.get('content-encoding')).toBe('gzip')
    expect(zipped!.headers.get('x-rsc-kit')).toBe('rendered')
    expect(JSON.parse(gunzipSync(new Uint8Array(await zipped!.arrayBuffer())).toString()).rows).toHaveLength(500)
    expect(raw!.headers.get('content-encoding')).toBeNull()
  })

  test('a small answer with no Content-Length goes out as it was', async () => {
    // Response.json() carries no length for the rule to read; the body is
    // peeked instead. /api/health was 15 bytes and came back gzipped.
    const small = {
      ...engine,
      async handleApiRoute() {
        return Response.json({ ok: true })
      },
    }
    const handle = createRscHandler({ engine: small as never })
    const answer = await handle(accepting('https://x.test/api/big'))

    expect(answer!.headers.get('content-encoding')).toBeNull()
    expect(await answer!.json()).toEqual({ ok: true })
  })

  test('and not when the host is told not to', async () => {
    const handle = createRscHandler({ engine: engine as never, compress: false })
    const answer = await handle(accepting('https://x.test/api/big'))

    expect(answer!.headers.get('content-encoding')).toBeNull()
  })
})
