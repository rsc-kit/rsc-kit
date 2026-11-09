/**
 * The policy each document goes out with: hashes where its body is whole
 * before it leaves, a nonce - the same one its render used - where it streams.
 */

import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { normaliseContentSecurityPolicy, type ContentSecurityPolicyOptions } from '../../src/csp'
import type { RouteManifest } from '../../src/manifest'

const hash = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`
const text = (body: string) =>
  new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(body))
      c.close()
    },
  })

function manifestOf(policy: ContentSecurityPolicyOptions | undefined, revalidate?: number): RouteManifest {
  return {
    version: 1,
    build: {
      output: 'server',
      exportPath: 'dist',
      payloadName: '',
      contentSecurityPolicy: normaliseContentSecurityPolicy(policy),
    },
    routes: [
      {
        component: 'app/posts/[slug]/page',
        segments: [
          { type: 'static', value: 'posts' },
          { type: 'dynamic', value: 'slug' },
        ],
        layouts: ['app/layout'],
        loadings: [],
        middleware: [],
        slots: {},
        sections: [],
        config: null,
        ancestorConfigs: [],
        staticParams: false,
        ...(revalidate ? { revalidate } : {}),
      } as never,
    ],
    intercepts: [],
  }
}

/** Renders `<script>run()</script>` with whatever nonce it was handed on it, and records the nonce. */
function engine() {
  const nonces: unknown[] = []

  return {
    nonces,
    installHostFn() {},
    async handleRscStream() {
      return { stream: text(''), segmentDepth: 0 }
    },
    async handleRscHtmlStream(_c: unknown, _p: unknown, _l: unknown, _lo: unknown, _s: unknown, _o: unknown, nonce: unknown) {
      nonces.push(nonce)

      return { htmlStream: text(`<html><body><script${nonce ? ` nonce="${nonce}"` : ''}>run()</script></body></html>`) }
    },
    async handleRscResume(...args: unknown[]) {
      nonces.push(args[7])

      return { htmlStream: text(`<script nonce="${args[7]}">$RC("B:0","S:0")</script>`) }
    },
  }
}

const policyOf = (response: Response, name = 'Content-Security-Policy') => response.headers.get(name) ?? ''
const nonceIn = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1]

describe('a page rendered per request', () => {
  test('a new nonce each time, the one its render put on its scripts', async () => {
    const e = engine()
    const handler = createRscHandler({ engine: e as never, manifest: manifestOf({}) })

    const first = (await handler(new Request('http://x/posts/one')))!
    const second = (await handler(new Request('http://x/posts/one')))!

    expect(nonceIn(policyOf(first))).toBe(e.nonces[0] as string)
    expect(nonceIn(policyOf(second))).toBe(e.nonces[1] as string)
    expect(e.nonces[0]).not.toBe(e.nonces[1])
    expect(await first.text()).toContain(`nonce="${e.nonces[0]}"`)
    expect(policyOf(first)).toContain(`script-src 'self' 'nonce-${e.nonces[0]}'`)
  })

  test('report-only goes out under its own name', async () => {
    const handler = createRscHandler({ engine: engine() as never, manifest: manifestOf({ reportOnly: true }) })
    const response = (await handler(new Request('http://x/posts/one')))!

    expect(response.headers.has('Content-Security-Policy')).toBe(false)
    expect(policyOf(response, 'Content-Security-Policy-Report-Only')).toContain("'nonce-")
  })

  test('no policy, no header and no nonce', async () => {
    const e = engine()
    const response = (await createRscHandler({ engine: e as never, manifest: manifestOf(undefined) })(new Request('http://x/posts/one')))!

    expect(response.headers.has('Content-Security-Policy')).toBe(false)
    expect(e.nonces).toEqual([undefined])
  })
})

test('a page a cache keeps gets no nonce: its scripts are hashed from the body it keeps', async () => {
  const e = engine()
  const handler = createRscHandler({ engine: e as never, manifest: manifestOf({}, 60) })
  const response = (await handler(new Request('http://x/posts/one')))!

  expect(e.nonces).toEqual([undefined])
  expect(response.headers.get('Cache-Control')).toContain('public')
  expect(policyOf(response)).toBe(
    `default-src 'self'; base-uri 'self'; object-src 'none'; style-src-attr 'unsafe-inline'; script-src 'self' ${hash('run()')}; style-src 'self'`,
  )

  // And the same for a revalidation the browser asks for: a 304 has no body.
  const again = (await handler(new Request('http://x/posts/one', { headers: { 'If-None-Match': response.headers.get('ETag')! } })))!

  expect(again.status).toBe(304)
  expect(policyOf(again)).toBe(policyOf(response))
})

test('a stored page is allowed by hash, with no nonce, so it stays one answer for everyone', async () => {
  const e = engine()
  const handler = createRscHandler({
    engine: e as never,
    manifest: manifestOf({}),
    prerendered: (name) => (name === 'posts/one.html' ? '<html><head><style>p{}</style></head><body><script>boot()</script>' : null),
  })
  const response = (await handler(new Request('http://x/posts/one')))!

  expect(response.headers.get('X-RSC-Kit')).toBe('stored')
  expect(policyOf(response)).toContain(`script-src 'self' ${hash('boot()')};`)
  expect(policyOf(response)).toContain(`style-src 'self' ${hash('p{}')}`)
  expect(nonceIn(policyOf(response))).toBeUndefined()
})

test("a shell is allowed by its hashes, and the holes resumed for this request by its nonce", async () => {
  const e = engine()
  const store = new Map([
    ['posts/one.ppr.html', '<html><body><script>boot()</script>'],
    ['posts/one.postponed.json', '{}'],
  ])
  const handler = createRscHandler({ engine: e as never, manifest: manifestOf({}), prerendered: (name) => store.get(name) ?? null })
  const response = (await handler(new Request('http://x/posts/one')))!
  const nonce = e.nonces[0] as string

  expect(response.headers.get('X-RSC-Kit')).toBe('shell')
  expect(typeof nonce).toBe('string')
  expect(policyOf(response)).toContain(`script-src 'self' ${hash('boot()')} 'nonce-${nonce}'`)
  expect(await response.text()).toContain(`<script nonce="${nonce}">$RC(`)
})

test("a stored page's policy is the same on every answer", async () => {
  const e = engine()
  const handler = createRscHandler({
    engine: e as never,
    manifest: manifestOf({}),
    prerendered: (name) => (name === 'posts/one.html' ? '<script>boot()</script>' : null),
  })
  const response = (await handler(new Request('http://x/posts/one')))!

  const again = (await handler(new Request('http://x/posts/one')))!

  expect(policyOf(again)).toBe(policyOf(response))
})
