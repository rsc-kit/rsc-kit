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
  isApiRoute,
  navigate,
  prefetch,
  setApiRoutes,
  setCallServer,
  setDeserializer,
  setHeldLayouts,
  setInterceptManifest,
  setNavigateHandler,
  setRestoreHandler,
} from '../../src/js/navigate'
import Link from '../../src/js/Link'

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
  setApiRoutes([])
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

// A route.ts answers with a Response, not a page. A link to one is a Route
// like any other for the typechecker; for the runtime it is an anchor: never
// prefetched - a hover must not sign someone out - and a full navigation
// rather than a payload fetch.
describe('a link to a route.ts', () => {
  test('is recognised by its pattern, dynamic segments and catch-alls included', () => {
    setApiRoutes(['/logout', '/api/orders/[id]', '/files/[...path]'])

    expect(isApiRoute('/logout')).toBe(true)
    expect(isApiRoute('/logout?next=/')).toBe(true)
    expect(isApiRoute('/api/orders/42')).toBe(true)
    expect(isApiRoute('/api/orders/42/items')).toBe(false)
    expect(isApiRoute('/files/a/b/c.pdf')).toBe(true)
    expect(isApiRoute('/orders')).toBe(false)
    expect(isApiRoute('/logout-page')).toBe(false)
  })

  test('is never prefetched', () => {
    installServer()
    setApiRoutes(['/logout'])

    prefetch('/logout')
    prefetch('/orders')

    expect(sent.map((s) => s.url)).toEqual(['/orders'])
  })

  test('navigates the document rather than fetching a payload', async () => {
    installServer()
    setApiRoutes(['/logout'])
    const went: string[] = []
    const original = Object.getOwnPropertyDescriptor(window, 'location')
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, origin: 'https://example.test', set href(v: string) { went.push(v) } },
    })

    try {
      await navigate('/logout' as never)
    } finally {
      if (original) Object.defineProperty(window, 'location', original)
    }

    expect(went).toEqual(['/logout'])
    expect(sent).toEqual([])
  })
})

describe('a device with no hover', () => {
  // happy-dom has neither matchMedia's hover query nor IntersectionObserver;
  // both stood in for, so the test can say what the screen shows.
  let observed: Element[] = []
  let intersect: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | null = null
  const realMatchMedia = window.matchMedia
  const realObserver = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
  const realIdle = (window as { requestIdleCallback?: unknown }).requestIdleCallback

  function touchDevice(hover: boolean) {
    ;(window as any).matchMedia = (query: string) => ({ matches: query === '(hover: none)' ? !hover : false })
    ;(globalThis as any).IntersectionObserver = class {
      constructor(cb: typeof intersect) {
        intersect = cb
      }
      observe(el: Element) {
        observed.push(el)
      }
      unobserve(el: Element) {
        observed = observed.filter((o) => o !== el)
      }
      disconnect() {}
    }
    ;(window as any).requestIdleCallback = (fn: () => void) => fn()
  }

  beforeEach(() => {
    observed = []
    intersect = null
  })

  afterEach(() => {
    window.matchMedia = realMatchMedia
    ;(globalThis as any).IntersectionObserver = realObserver
    ;(window as any).requestIdleCallback = realIdle
  })

  async function render(node: React.ReactNode) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(node)
    })
    return container.querySelector('a')!
  }

  test('prefetches a link as it comes into view, once', async () => {
    // On a phone the first signal is touchstart, and the click lands about a
    // round trip after it - a prefetch started there has barely left. The
    // links on screen are prefetched instead, as Next does, which is what
    // makes a tap feel instant there.
    touchDevice(false)
    const calls: string[] = []
    ;(window as any).__rsc_prefetch = (u: string) => calls.push(u)

    const a = await render(<Link href="/on-screen">x</Link>)

    expect(observed).toContain(a)

    intersect!([{ target: a, isIntersecting: false }])
    expect(calls).toEqual([])

    intersect!([{ target: a, isIntersecting: true }])
    expect(calls).toEqual(['/on-screen'])
    expect(observed).not.toContain(a)
  })

  test('a link that opted out is not watched', async () => {
    touchDevice(false)
    ;(window as any).__rsc_prefetch = () => {}

    const a = await render(<Link href="/never" prefetch={false}>x</Link>)

    expect(observed).not.toContain(a)
  })

  test('a device that can hover keeps the hover signal instead', async () => {
    touchDevice(true)
    ;(window as any).__rsc_prefetch = () => {}

    const a = await render(<Link href="/desktop">x</Link>)

    expect(observed).not.toContain(a)
  })

  test("the caller's ref still fills", async () => {
    touchDevice(false)
    ;(window as any).__rsc_prefetch = () => {}
    const got: { current: HTMLAnchorElement | null } = { current: null }

    const a = await render(
      <Link href="/focus" ref={got}>
        x
      </Link>,
    )

    expect(got.current).toBe(a)
  })
})

describe('what a prefetch decodes', () => {
  test('nothing until a navigation asks; the bytes are kept', async () => {
    // Decoding a payload loads the client chunks it names. A landing page
    // prefetching its sign-in link on a phone was loading the sign-in
    // page's thirty chunks for every visitor, tapped or not.
    installServer()
    const decoded: string[] = []
    setDeserializer(async (stream: ReadableStream) => {
      const text = await new Response(stream).text()
      decoded.push(text)
      return text
    })

    prefetch('/kept')
    await new Promise((r) => setTimeout(r, 30))

    expect(sent.map((s) => s.url)).toEqual(['/kept'])
    expect(decoded).toEqual([])

    await navigate('/kept' as never)

    expect(decoded).toEqual(['/kept'])
    expect(sent.map((s) => s.url)).toEqual(['/kept'])
  })
})

describe('what is never prefetched', () => {
  test('the page the visitor is on', async () => {
    // A logo link to / on the home page, in view, was a 14 KB payload for
    // the page already on screen.
    installServer()
    history.replaceState({}, '', '/start')

    prefetch('/start')
    prefetch('/elsewhere')
    await new Promise((r) => setTimeout(r, 20))

    expect(sent.map((s) => s.url)).toEqual(['/elsewhere'])
  })

  test('a page a navigation is already fetching', async () => {
    // A held tap's replay lands beside the idle viewport prefetch of the
    // link it came from: two requests for one page.
    installServer({ hold: true })

    const nav = navigate('/twice' as never)
    await new Promise((r) => setTimeout(r, 10))
    prefetch('/twice')
    await new Promise((r) => setTimeout(r, 10))

    expect(sent.filter((s) => s.url === '/twice')).toHaveLength(1)

    release['/twice']()
    await nav
  })
})

// Last in the file on purpose: the update store is module state, and a
// session marked stale stays stale for every test after it.
describe('once the page is known to be the previous build', () => {
  test('nothing is prefetched', async () => {
    // The next navigation is a document load; a payload it would not use
    // is a 409 for nothing - one per tap, from the link's touchstart.
    installServer()
    const { markStale } = await import('../../src/js/updateStore')

    markStale()
    prefetch('/never')
    await new Promise((r) => setTimeout(r, 20))

    expect(sent).toEqual([])
  })

})
