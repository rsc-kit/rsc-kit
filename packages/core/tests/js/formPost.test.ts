// A form submitted before the page had a runtime.
//
// React writes the action's id into the form it emits for a server action
// and points the form at the page's own url, so a browser with no javascript
// yet - a slow connection, a stored page mid-hydration, a visitor with it
// off - posts there. Until this existed the host answered that post with
// "Not found", which the forms guide had promised would not happen.

import { beforeAll, describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('formPost.test.ts')

let engine: any
let handle: (request: Request) => Promise<Response | null>
let fields: Record<string, string>

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import('./goHost')

  await buildFixtureOnce()
  engine = await import(bundlePath)
  handle = createRscHandler({ engine, manifest: engine.manifest() })

  // What the browser would post: every hidden field React put in the form.
  const html = await (await handle(new Request('https://app.test/subscribe')))!.text()

  fields = Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?/g)].map((m) => [
      m[1].replace(/&amp;/g, '&'),
      (m[2] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    ]),
  )
}, 300_000)

const post = (extra: Record<string, string>, headers: Record<string, string> = {}) => {
  const body = new URLSearchParams({ ...fields, ...extra })

  return handle(
    new Request('https://app.test/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test', ...headers },
      body,
    }),
  )
}

describe('a form posted to the page', () => {
  test('carries the action id React wrote into it', () => {
    expect(Object.keys(fields).some((name) => name.startsWith('$ACTION_ID_'))).toBe(true)
  })

  test('runs the action, sets its cookie, and renders the page again', async () => {
    const response = await post({ email: 'ada@example.com', then: 'stay' })

    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toContain('text/html')
    expect(response?.headers.get('set-cookie')).toContain('subscribed=ada%40example.com')
    expect(response?.headers.get('cache-control')).toBe('no-store')
    expect(await response!.text()).toContain('<form')
  })

  test('follows the redirect the action threw, as a document would', async () => {
    const response = await post({ email: 'ada@example.com', then: 'go' })

    expect(response?.status).toBe(307)
    expect(response?.headers.get('location')).toBe('/subscribed')
    expect(response?.headers.get('set-cookie')).toContain('subscribed=')
  })

  test('from another origin is not a form post at all', async () => {
    const response = await post({ email: 'ada@example.com', then: 'stay' }, { origin: 'https://evil.test' })

    expect(response).toBeNull()
  })

  test('a post that names no action just renders the page', async () => {
    const body = new URLSearchParams({ email: 'x' })
    const response = await handle(
      new Request('https://app.test/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }),
    )

    expect(response?.status).toBe(200)
    expect(response?.headers.get('set-cookie')).toBeNull()
  })

  test('a post to a url that is not a page is still nothing of ours', async () => {
    const response = await handle(
      new Request('https://app.test/nowhere', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      }),
    )

    expect(response).toBeNull()
  })
})
