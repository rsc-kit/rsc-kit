/**
 * Prefetch is speculative; a navigation is not. Until these changes the two
 * were indistinguishable — same headers, same priority, nothing cancelling a
 * request the pointer had already moved past. A sweep across a nav bar filled
 * the browser's per-origin connection limit with pages nobody asked for, and a
 * real click queued behind them.
 */

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  cancelPrefetch,
  navigate,
  prefetch,
  setCallServer,
  setDeserializer,
  setHeldLayouts,
  setInterceptManifest,
  setNavigateHandler,
  setRestoreHandler,
} from '../../src/js/navigate.ts'
import Link from '../../src/js/Link.tsx'

interface Sent {
  url: string
  priority?: string
  signal?: AbortSignal
}

let sent: Sent[] = []
/** Resolves the pending response for a url, so a prefetch can be held open. */
let release: Record<string, () => void> = {}

function installServer(opts: { hold?: boolean } = {}) {
  ;(globalThis as { fetch: unknown }).fetch = (
    input: unknown,
    init?: { priority?: string; signal?: AbortSignal },
  ) => {
    const url = new URL(String(input), 'https://example.test').pathname
    sent.push({ url, priority: init?.priority, signal: init?.signal })

    const respond = () =>
      new Response(url, {
        headers: { 'Content-Type': 'text/x-component', 'X-RSC-Segment-Depth': '0', 'X-RSC-Layouts': '' },
      })

    if (!opts.hold) return Promise.resolve(respond())

    return new Promise<Response>((resolve, reject) => {
      release[url] = () => resolve(respond())
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
  }
}

beforeEach(() => {
  sent = []
  release = {}
  history.replaceState({}, '', '/start')
  setDeserializer(async (stream: ReadableStream) => await new Response(stream).text())
  setCallServer(async () => null)
  setNavigateHandler(() => {})
  setRestoreHandler(() => false)
  setInterceptManifest([])
  setHeldLayouts([])
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('request priority', () => {
  test('a prefetch is sent at low priority', async () => {
    installServer()
    prefetch('/low-priority')
    await Promise.resolve()

    expect(sent.at(-1)?.priority).toBe('low')
  })

  test('a navigation is sent at high priority', async () => {
    installServer()
    await navigate('/high-priority')

    expect(sent.at(-1)?.priority).toBe('high')
  })
})

describe('cancelling a prefetch the pointer left', () => {
  test('aborts a request still in flight', async () => {
    installServer({ hold: true })
    prefetch('/aborted')
    await Promise.resolve()

    expect(sent.at(-1)?.signal?.aborted).toBe(false)

    cancelPrefetch('/aborted')

    expect(sent.at(-1)?.signal?.aborted).toBe(true)
  })

  test('a click straight after a cancel refetches rather than rendering nothing', async () => {
    // The cache entry has to go synchronously. The abort rejects a tick later,
    // and the catch that clears the entry runs later still — so a click in
    // between would find an entry whose tree resolves to null and navigate to
    // a blank page.
    installServer({ hold: true })
    prefetch('/refetched')
    await Promise.resolve()

    cancelPrefetch('/refetched')

    const before = sent.length
    const done = navigate('/refetched')
    release['/refetched']?.()
    await done

    expect(sent.length).toBe(before + 1)
    expect(sent.at(-1)?.priority).toBe('high')
  })

  test('leaves a prefetch that already landed alone', async () => {
    // Nothing to cancel, and the payload is still good — dropping it would
    // throw away the whole point of having prefetched.
    installServer()
    prefetch('/landed')
    await new Promise((r) => setTimeout(r, 10))

    const afterPrefetch = sent.length
    cancelPrefetch('/landed')
    await navigate('/landed')

    expect(sent.length).toBe(afterPrefetch)
  })
})

describe('hover debounce', () => {
  async function render(node: React.ReactNode) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(node)
    })
    return container.querySelector('a')!
  }

  function hover(el: Element, type: 'mouseover' | 'mouseout') {
    el.dispatchEvent(new (window as any).MouseEvent(type, { bubbles: true }))
  }

  test('a pointer passing over a link does not prefetch it', async () => {
    installServer()
    const calls: string[] = []
    ;(window as any).__rsc_prefetch = (u: string) => calls.push(u)

    const a = await render(<Link href="/passed-over">x</Link>)

    // A real pointer is over the link for a moment on its way past — long
    // enough that a same-tick mouseout would not be a fair test of anything.
    hover(a, 'mouseover')
    await new Promise((r) => setTimeout(r, 40))
    hover(a, 'mouseout')
    await new Promise((r) => setTimeout(r, 200))

    expect(calls).toEqual([])
  })

  test('a pointer that settles prefetches', async () => {
    installServer()
    const calls: string[] = []
    ;(window as any).__rsc_prefetch = (u: string) => calls.push(u)

    const a = await render(<Link href="/settled">x</Link>)

    hover(a, 'mouseover')
    await new Promise((r) => setTimeout(r, 200))

    expect(calls).toEqual(['/settled'])
  })

  test('leaving asks for an in-flight prefetch to be cancelled', async () => {
    installServer()
    const cancelled: string[] = []
    ;(window as any).__rsc_prefetch = () => {}
    ;(window as any).__rsc_cancel_prefetch = (u: string) => cancelled.push(u)

    const a = await render(<Link href="/left">x</Link>)

    hover(a, 'mouseover')
    await new Promise((r) => setTimeout(r, 200))
    hover(a, 'mouseout')

    expect(cancelled).toEqual(['/left'])
  })
})
