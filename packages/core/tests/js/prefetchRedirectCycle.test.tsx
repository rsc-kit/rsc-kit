/**
 * A prefetch that lands on a redirect keeps the guard's answer and prefetches
 * the destination, and a touch warms the held entry by following that
 * redirect to the destination's entry. Two entries can point at each other -
 * a guard's answer kept from before a sign-in beside the live one after it -
 * and a destination can normalise to the key of the entry that named it.
 * Every entry in such a chain is settled, so following it is a chain of
 * resolved promises: no request, no yield, the tab pegged at 100% until it
 * is killed. A port found its landing page freezing on the first tap after a
 * hard reload, with nothing in the console and the network idle.
 *
 * Its own file: prefetchThrottle marks the page stale partway through, and a
 * stale page prefetches nothing.
 */

import { registerDom } from './dom'

registerDom()

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  prefetch,
  setApiRoutes,
  setCallServer,
  setDeserializer,
  setHeldLayouts,
  setInterceptManifest,
  setNavigateHandler,
  setRestoreHandler,
} from '../../src/js/navigate'

let sent: string[] = []

/** Every url answers 204 and a redirect to the url the table gives it. */
function installRedirects(redirects: Record<string, string>) {
  ;(globalThis as { fetch: unknown }).fetch = (input: unknown) => {
    const url = new URL(String(input), 'https://example.test').pathname
    sent.push(url)

    return Promise.resolve(
      new Response(null, {
        status: 204,
        headers: { 'X-RSC-Redirect': redirects[url] ?? '/', 'X-RSC-Segment-Depth': '0', 'X-RSC-Layouts': '' },
      }),
    )
  }
}

/** The one thing an unbounded chain of settled promises never allows: a timer firing. */
const yields = () => new Promise<string>((r) => setTimeout(() => r('yielded'), 20))

beforeEach(() => {
  sent = []
  history.replaceState({}, '', '/start')
  setDeserializer(async (stream: ReadableStream) => await new Response(stream).text())
  setCallServer(async () => null)
  setNavigateHandler(() => {})
  setRestoreHandler(() => false)
  setInterceptManifest([])
  setHeldLayouts([])
  setApiRoutes([])
})

describe('a prefetched redirect that leads back to itself', () => {
  test('two guards pointing at each other are followed once each, and the touch returns', async () => {
    installRedirects({ '/agent': '/login', '/login': '/agent' })
    prefetch('/agent')
    await new Promise((r) => setTimeout(r, 0))

    // The redirect was followed once, and the destination's own redirect
    // found /agent already held - no third request.
    expect(sent).toEqual(['/agent', '/login'])

    prefetch('/agent', undefined, true)

    expect(await yields()).toBe('yielded')
  })

  test('a redirect to a spelling of its own url is not followed into itself', async () => {
    // /agent/ and /agent share a retention key, so the destination's entry is
    // the entry being warmed.
    installRedirects({ '/agent/': '/agent' })
    prefetch('/agent/')
    await new Promise((r) => setTimeout(r, 0))
    prefetch('/agent/', undefined, true)

    expect(await yields()).toBe('yielded')
  })
})
