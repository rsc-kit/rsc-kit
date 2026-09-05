/**
 * Reachability, as the router observes it.
 *
 * `navigator.onLine` reports whether a network interface is up, not whether
 * anything answers on it — a captive portal reads as online. The router sees
 * how requests actually end, so it is the better signal, and these pin the
 * distinctions that make it better rather than merely different.
 */

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { isReachable, reportReachable } from '../../src/js/onlineStore'
import { useOnline, useOffline } from '../../src/js/useOnline'
import {
  navigate,
  prefetch,
  cancelPrefetch,
  setCallServer,
  setDeserializer,
  setHeldLayouts,
  setInterceptManifest,
  setNavigateHandler,
  setRestoreHandler,
} from '../../src/js/navigate'

function serverThat(behaviour: 'answers' | 'unreachable' | 'errors' | 'hangs') {
  ;(globalThis as { fetch: unknown }).fetch = (_u: unknown, init?: { signal?: AbortSignal }) => {
    if (behaviour === 'unreachable') return Promise.reject(new TypeError('Failed to fetch'))
    if (behaviour === 'hangs') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }

    return Promise.resolve(
      new Response('x', {
        status: behaviour === 'errors' ? 500 : 200,
        headers: { 'Content-Type': 'text/x-component', 'X-RSC-Segment-Depth': '0', 'X-RSC-Layouts': '' },
      }),
    )
  }
}

beforeEach(() => {
  reportReachable(true)
  history.replaceState({}, '', '/start')
  setDeserializer(async (stream: ReadableStream) => await new Response(stream).text())
  setCallServer(async () => null)
  setNavigateHandler(() => {})
  setRestoreHandler(() => false)
  setInterceptManifest([])
  setHeldLayouts([])
})

let mounted: Array<{ unmount: () => void }> = []

afterEach(async () => {
  // Roots left mounted would still be subscribed, and a later report would
  // update them outside act().
  await act(async () => {
    for (const root of mounted) root.unmount()
  })
  mounted = []
  document.body.innerHTML = ''
})

describe('what counts as unreachable', () => {
  test('a navigation that never gets an answer marks the app offline', async () => {
    serverThat('unreachable')

    await navigate('/nowhere').catch(() => {})

    expect(isReachable()).toBe(false)
  })

  test('a server error does not — something answered', async () => {
    // The distinction navigator.onLine cannot make, and the reason a 500 must
    // not put the whole app into an offline state.
    serverThat('errors')
    reportReachable(true)

    await navigate('/broken').catch(() => {})

    expect(isReachable()).toBe(true)
  })

  test('a cancelled prefetch does not — the abort was ours', async () => {
    // Leaving a link aborts its prefetch. Reading our own cancellation as a
    // network failure would report offline every time a pointer moved on.
    serverThat('hangs')
    reportReachable(true)

    prefetch('/left')
    await Promise.resolve()
    cancelPrefetch('/left')
    await new Promise((r) => setTimeout(r, 10))

    expect(isReachable()).toBe(true)
  })

  test('a later success marks it back', async () => {
    serverThat('unreachable')
    await navigate('/nowhere').catch(() => {})
    expect(isReachable()).toBe(false)

    serverThat('answers')
    await navigate('/back')

    expect(isReachable()).toBe(true)
  })
})

describe('a navigation that fails is not silent', () => {
  test('it announces the failure rather than doing nothing at all', async () => {
    // Before this the click cleared its own pending state and the page stayed
    // as it was: no error, no fallback, nothing an app could react to.
    serverThat('unreachable')

    const seen: string[] = []
    const onError = (e: Event) => seen.push((e as CustomEvent).detail.url)
    window.addEventListener('rsc-navigate-error', onError)

    await navigate('/nowhere').catch(() => {})
    window.removeEventListener('rsc-navigate-error', onError)

    expect(seen).toEqual(['/nowhere'])
  })
})

describe('the hook', () => {
  async function renderProbe() {
    const container = document.createElement('div')
    document.body.appendChild(container)

    function Probe() {
      return `${useOnline()}/${useOffline()}`
    }

    await act(async () => {
      const root = createRoot(container)
      mounted.push(root)
      root.render(<Probe />)
    })

    return container
  }

  test('reflects the router’s view, and updates when it changes', async () => {
    reportReachable(true)
    const container = await renderProbe()

    expect(container.textContent).toBe('true/false')

    await act(async () => {
      reportReachable(false)
    })

    expect(container.textContent).toBe('false/true')
  })

  test('an unchanged outcome does not notify', async () => {
    // The snapshot is a boolean so React compares it by value; reporting the
    // same state repeatedly must be inert rather than a render per report.
    let notifications = 0
    const stop = (await import('../../src/js/onlineStore')).subscribeReachable(() => {
      notifications++
    })

    reportReachable(true)
    reportReachable(true)
    reportReachable(false)
    reportReachable(false)
    stop()

    expect(notifications).toBe(1)
  })
})
