/**
 * The request the page hydrates from, and what happens when it fails.
 *
 * A PPR route's shell is real HTML with a 200, so a page whose payload never
 * arrives looks like it loaded and then sits on its Suspense fallbacks for
 * good. Nothing else is watching this request — which is why every branch here
 * has to say something.
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fetchPagePayload } from '../../src/js/pagePayload'
import { isReachable, reportReachable } from '../../src/js/onlineStore'

let announced: Array<{ scope: string; error: unknown }> = []
let logged: unknown[] = []
let originalError: typeof console.error

function listen(e: Event) {
  announced.push((e as CustomEvent).detail)
}

beforeEach(() => {
  announced = []
  logged = []
  reportReachable(true)
  window.addEventListener('rsc-client-error', listen)
  originalError = console.error
  console.error = (...args: unknown[]) => logged.push(args)
})

afterEach(() => {
  window.removeEventListener('rsc-client-error', listen)
  console.error = originalError
})

const ok = () =>
  Promise.resolve(new Response('flight', { status: 200, headers: { 'X-RSC-Layouts': 'app/layout' } }))

describe('fetching the page payload', () => {
  test('returns the response when the server answers', async () => {
    const res = await fetchPagePayload('/docs/rsc', ok as unknown as typeof fetch)

    expect(res.headers.get('X-RSC-Layouts')).toBe('app/layout')
    expect(announced).toEqual([])
  })

  test('asks for the url it was given', async () => {
    // Which is not always the page's own: an exported build points payloads at
    // a file of their own, since a static host cannot act on the header.
    const seen: string[] = []
    const spy = ((url: string) => {
      seen.push(url)

      return ok()
    }) as unknown as typeof fetch

    await fetchPagePayload('/docs/rsc/index.rsc', spy)

    expect(seen).toEqual(['/docs/rsc/index.rsc'])
  })

  test('sends the header that distinguishes a payload from a page', async () => {
    let headers: Record<string, string> = {}
    const spy = ((_u: string, init: { headers: Record<string, string> }) => {
      headers = init.headers

      return ok()
    }) as unknown as typeof fetch

    await fetchPagePayload('/docs/rsc', spy)

    expect(headers['X-RSC']).toBe('1')
  })

  test('a server that answers badly is reported, and reachable', async () => {
    // A 500 is a server that answered. Marking the app offline for it would
    // be wrong, and useOffline reads this.
    const failing = (() => Promise.resolve(new Response('', { status: 500 }))) as unknown as typeof fetch

    await expect(fetchPagePayload('/docs/rsc', failing)).rejects.toThrow('500')

    expect(isReachable()).toBe(true)
    expect(announced).toHaveLength(1)
    expect(announced[0].scope).toBe('the server could not render this page')
    expect(logged).toHaveLength(1)
  })

  test('a request nothing answers marks the app offline', async () => {
    const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch

    await expect(fetchPagePayload('/docs/rsc', offline)).rejects.toThrow('Failed to fetch')

    expect(isReachable()).toBe(false)
    expect(announced[0].scope).toBe('could not fetch the page payload')
  })

  test('a success after a failure marks it reachable again', async () => {
    const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch

    await fetchPagePayload('/docs/rsc', offline).catch(() => {})
    expect(isReachable()).toBe(false)

    await fetchPagePayload('/docs/rsc', ok as unknown as typeof fetch)

    expect(isReachable()).toBe(true)
  })

  test('the failure is rethrown, not swallowed', async () => {
    // Reporting without rethrowing would let hydration carry on and hand the
    // Flight decoder a body that is not Flight.
    const failing = (() => Promise.resolve(new Response('', { status: 503 }))) as unknown as typeof fetch
    let reached = false

    try {
      await fetchPagePayload('/docs/rsc', failing)
      reached = true
    } catch {
      // expected
    }

    expect(reached).toBe(false)
  })
})
