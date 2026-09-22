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
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
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
  setPrerenderHandler,
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

// The viewport observer, stood in for before any Link renders - see 'a link
// on screen'.
const observed: Element[] = []
let intersect: ((entries: { target: Element; isIntersecting: boolean }[]) => void) | null = null
;(globalThis as any).IntersectionObserver = class {
  constructor(cb: typeof intersect) {
    intersect = cb
  }
  observe(el: Element) {
    observed.push(el)
  }
  unobserve(el: Element) {
    const at = observed.indexOf(el)
    if (at >= 0) observed.splice(at, 1)
  }
  disconnect() {}
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

  test('a pointer that settles is intent: the payload is decoded as it lands', async () => {
    installServer()
    const calls: [string, number | undefined, boolean][] = []
    ;(window as any).__rsc_prefetch = (u: string, ttl: number | undefined, intent: boolean) =>
      calls.push([u, ttl, intent])

    const a = await render(<Link href="/settled">x</Link>)

    hover(a, 'mouseover')
    await new Promise((r) => setTimeout(r, 200))

    expect(calls).toEqual([['/settled', undefined, true]])
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

    // And says why, before it goes: a document load is the one thing the
    // router does that looks like a bug when it was a decision.
    const announced: unknown[] = []
    const onLoad = (e: Event) => announced.push((e as CustomEvent).detail)
    window.addEventListener('rsc-kit:document-load', onLoad)

    try {
      await navigate('/logout' as never)
    } finally {
      if (original) Object.defineProperty(window, 'location', original)
      window.removeEventListener('rsc-kit:document-load', onLoad)
    }

    expect(went).toEqual(['/logout'])
    expect(sent).toEqual([])
    expect(announced).toEqual([{ url: '/logout', reason: 'api-route' }])
  })
})

describe('a link on screen', () => {
  // happy-dom has neither matchMedia's hover query nor IntersectionObserver;
  // both stood in for, so the test can say what the screen shows. One
  // observer serves every link for the life of the module, so the stand-in
  // is installed once, before the first render, and records into a list
  // each test empties.
  const realMatchMedia = window.matchMedia
  const realObserver = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
  const realIdle = (window as { requestIdleCallback?: unknown }).requestIdleCallback

  function touchDevice(hover: boolean) {
    ;(window as any).matchMedia = (query: string) => ({ matches: query === '(hover: none)' ? !hover : false })
  }

  beforeEach(() => {
    observed.length = 0
    ;(window as any).requestIdleCallback = (fn: () => void) => fn()
  })

  afterEach(() => {
    window.matchMedia = realMatchMedia
    ;(window as any).requestIdleCallback = realIdle
  })

  afterAll(() => {
    ;(globalThis as any).IntersectionObserver = realObserver
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
    const calls: [string, boolean][] = []
    ;(window as any).__rsc_prefetch = (u: string, _ttl: number | undefined, intent: boolean) =>
      calls.push([u, intent])

    const a = await render(<Link href="/on-screen">x</Link>)

    expect(observed).toContain(a)

    intersect!([{ target: a, isIntersecting: false }])
    expect(calls).toEqual([])

    // The bytes only: decoding loads the chunks the page names, and every
    // link on a landing page is on screen.
    intersect!([{ target: a, isIntersecting: true }])
    expect(calls).toEqual([['/on-screen', false]])
    expect(observed).not.toContain(a)
  })

  test('the touch is what decodes them', async () => {
    // The one under a thumb is the one about to be followed, and its click
    // is a round trip away - time enough for the chunks, spent before the
    // click instead of after it.
    touchDevice(false)
    const calls: [string, boolean][] = []
    ;(window as any).__rsc_prefetch = (u: string, _ttl: number | undefined, intent: boolean) =>
      calls.push([u, intent])

    const a = await render(<Link href="/tapped">x</Link>)

    await act(async () => {
      a.dispatchEvent(new Event('touchstart', { bubbles: true }))
    })

    expect(calls).toEqual([['/tapped', true]])
  })

  test('a link that opted out is not watched', async () => {
    touchDevice(false)
    ;(window as any).__rsc_prefetch = () => {}

    const a = await render(<Link href="/never" prefetch={false}>x</Link>)

    expect(observed).not.toContain(a)
  })

  test('a device that can hover watches too: a hover is a round trip too late to fetch the bytes', async () => {
    // It used to leave desktop to the hover, and a click quicker than the
    // round trip waited for it. Next fetches what is on screen on every
    // device, and that is what its clicks are compared against.
    touchDevice(true)
    ;(window as any).__rsc_prefetch = () => {}

    const a = await render(<Link href="/desktop">x</Link>)

    expect(observed).toContain(a)
  })

  test('a dozen on sight per page; the rest wait for a touch or a hover', async () => {
    // A product page's payload is 30 KB with its related products, and a
    // listing shows twenty-four of them: every one on sight was three
    // quarters of a megabyte per page on a phone.
    touchDevice(false)
    const calls: string[] = []
    ;(window as any).__rsc_prefetch = (u: string) => calls.push(u)
    window.dispatchEvent(new CustomEvent('rsc-navigate', { detail: '/list' }))

    const anchors: HTMLAnchorElement[] = []

    for (let i = 0; i < 15; i++) anchors.push(await render(<Link href={`/item/${i}` as never}>x</Link>))

    for (const a of anchors) intersect!([{ target: a, isIntersecting: true }])

    expect(calls).toHaveLength(12)
    expect(calls[0]).toBe('/item/0')
    expect(calls).not.toContain('/item/12')

    // Past the budget, a touch still fetches it - with intent.
    ;(window as any).__rsc_prefetch = (u: string, _ttl: number | undefined, intent: boolean) => calls.push(`${u}:${intent}`)
    await act(async () => {
      anchors[13]!.dispatchEvent(new Event('touchstart', { bubbles: true }))
    })
    expect(calls.at(-1)).toBe('/item/13:true')

    // A navigation starts the budget again.
    window.dispatchEvent(new CustomEvent('rsc-navigate', { detail: '/next' }))
    ;(window as any).__rsc_prefetch = (u: string) => calls.push(u)
    const later = await render(<Link href={'/item/99' as never}>x</Link>)
    intersect!([{ target: later, isIntersecting: true }])
    expect(calls.at(-1)).toBe('/item/99')
  })

  test('not for a visitor who asked for less data', async () => {
    touchDevice(false)
    ;(window as any).__rsc_prefetch = () => {}
    const real = Object.getOwnPropertyDescriptor(navigator, 'connection')
    Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true }) })

    try {
      const a = await render(<Link href="/lite">x</Link>)

      expect(observed).not.toContain(a)
    } finally {
      if (real) Object.defineProperty(navigator, 'connection', real)
      else delete (navigator as { connection?: unknown }).connection
    }
  })

  test('a press is intent, for a click quicker than the hover settles', async () => {
    touchDevice(true)
    const calls: [string, boolean][] = []
    ;(window as any).__rsc_prefetch = (u: string, _ttl: number | undefined, intent: boolean) =>
      calls.push([u, intent])

    const a = await render(<Link href="/pressed">x</Link>)

    await act(async () => {
      a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }))
    })
    expect(calls).toEqual([])

    await act(async () => {
      a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    })
    expect(calls).toEqual([['/pressed', true]])
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

  test('with intent, the payload as it lands - and the navigation finds it decoded', async () => {
    // A hover that settled, a touch: the visitor is on the way, and the
    // chunks the page names are wanted now, not a round trip after the
    // click.
    installServer()
    const decoded: string[] = []
    setDeserializer(async (stream: ReadableStream) => {
      const text = await new Response(stream).text()
      decoded.push(text)
      return text
    })

    prefetch('/meant', undefined, true)
    await new Promise((r) => setTimeout(r, 30))

    expect(sent.map((s) => s.url)).toEqual(['/meant'])
    expect(decoded).toEqual(['/meant'])

    await navigate('/meant' as never)

    // Once: the navigation took the decoded tree, not the bytes again.
    expect(decoded).toEqual(['/meant'])
    expect(sent.map((s) => s.url)).toEqual(['/meant'])
  })

  test('a touch on a link the viewport already fetched decodes what is held, without a second request', async () => {
    installServer()
    const decoded: string[] = []
    setDeserializer(async (stream: ReadableStream) => {
      const text = await new Response(stream).text()
      decoded.push(text)
      return text
    })

    prefetch('/seen')
    await new Promise((r) => setTimeout(r, 30))
    expect(decoded).toEqual([])

    prefetch('/seen', undefined, true)
    await new Promise((r) => setTimeout(r, 30))

    expect(sent.map((s) => s.url)).toEqual(['/seen'])
    expect(decoded).toEqual(['/seen'])
  })

  test('a decode that fails with intent is quiet; the navigation reports it', async () => {
    installServer()
    setDeserializer(async () => {
      throw new Error('Failed to fetch dynamically imported module: /assets/gone.js')
    })
    const unhandled: unknown[] = []
    const onUnhandled = (e: PromiseRejectionEvent) => unhandled.push(e.reason)
    window.addEventListener('unhandledrejection', onUnhandled)

    prefetch('/breaks', undefined, true)
    await new Promise((r) => setTimeout(r, 30))

    expect(unhandled).toEqual([])
    window.removeEventListener('unhandledrejection', onUnhandled)
  })
})

describe('how long a prefetched payload is held', () => {
  function serverWith(cacheControl: string) {
    ;(globalThis as { fetch: unknown }).fetch = (input: unknown) => {
      const url = new URL(String(input), 'https://example.test').pathname
      sent.push({ url })
      return Promise.resolve(
        new Response(url, {
          headers: {
            'Content-Type': 'text/x-component',
            'X-RSC-Segment-Depth': '0',
            'X-RSC-Layouts': '',
            'Cache-Control': cacheControl,
          },
        }),
      )
    }
  }

  const realNow = Date.now

  afterEach(() => {
    Date.now = realNow
  })

  async function heldAfter(ms: number, url: string): Promise<boolean> {
    const start = realNow()
    Date.now = () => start + ms
    const before = sent.length
    prefetch(url)
    await new Promise((r) => setTimeout(r, 10))
    return sent.length === before
  }

  test('a page the host marked public, for five minutes: the build made it, and only a deploy changes it', async () => {
    // Thirty seconds was right for a page rendered per request. A landing
    // page read for a minute before the tap on Sign in was an expired
    // entry, and on a phone a round trip after the tap.
    serverWith('public, max-age=0, must-revalidate')

    prefetch('/frozen')
    await new Promise((r) => setTimeout(r, 10))

    expect(await heldAfter(60_000, '/frozen')).toBe(true)
    expect(await heldAfter(299_000, '/frozen')).toBe(true)
    expect(await heldAfter(301_000, '/frozen')).toBe(false)
  })

  test('a page rendered per visitor, for thirty seconds', async () => {
    serverWith('private, no-store')

    prefetch('/mine')
    await new Promise((r) => setTimeout(r, 10))

    expect(await heldAfter(29_000, '/mine')).toBe(true)
    expect(await heldAfter(31_000, '/mine')).toBe(false)
  })

  test('a link that said how long is believed over the header', async () => {
    serverWith('public, max-age=0, must-revalidate')

    prefetch('/said', 5_000)
    await new Promise((r) => setTimeout(r, 10))

    expect(await heldAfter(4_000, '/said')).toBe(true)
    expect(await heldAfter(6_000, '/said')).toBe(false)
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

describe('the click waits for the pictures the page shows at once', () => {
  const RealImage = (globalThis as { Image: unknown }).Image
  const live: { complete: boolean; settle: () => void }[] = []

  function stubImages() {
    live.length = 0
    ;(globalThis as { Image: unknown }).Image = class {
      decoding = ''
      fetchPriority = ''
      complete = false
      resolve: () => void = () => {}
      decoded = new Promise<void>((r) => {
        this.resolve = r
      })
      set sizes(_: string) {}
      set srcset(_: string) {}
      set src(_: string) {
        live.push(this as never)
      }
      decode() {
        return this.decoded
      }
      settle() {
        this.complete = true
        this.resolve()
      }
    }
  }

  /** A server whose payload for a url names one eager picture. */
  function installPictureServer() {
    ;(globalThis as { fetch: unknown }).fetch = (input: unknown) => {
      const url = new URL(String(input), 'https://example.test').pathname
      sent.push({ url })

      return Promise.resolve(
        new Response(`0:["$","img",null,{"loading":"eager","src":"${url}.webp"}]\n`, {
          headers: { 'Content-Type': 'text/x-component', 'X-RSC-Segment-Depth': '0', 'X-RSC-Layouts': '' },
        }),
      )
    }
  }

  afterEach(() => {
    ;(globalThis as { Image: unknown }).Image = RealImage
  })

  test('a prefetched page is applied once its picture is decoded', async () => {
    stubImages()
    installPictureServer()
    let applied = 0
    setNavigateHandler(() => {
      applied++
    })

    prefetch('/pictured')
    await new Promise((r) => setTimeout(r, 5))
    expect(live.length).toBe(1)

    const nav = navigate('/pictured')
    await new Promise((r) => setTimeout(r, 20))
    expect(applied).toBe(0)

    live[0].settle()
    await nav
    expect(applied).toBe(1)
    expect(performance.getEntriesByName('rsc-kit:navigate:pictures').length).toBeGreaterThan(0)
  })

  test('and without waiting when the picture is already there', async () => {
    stubImages()
    installPictureServer()
    let applied = 0
    setNavigateHandler(() => {
      applied++
    })

    prefetch('/pictured-ready')
    await new Promise((r) => setTimeout(r, 5))
    live[0].settle()

    const started = Date.now()
    await navigate('/pictured-ready')
    expect(applied).toBe(1)
    expect(Date.now() - started).toBeLessThan(100)
  })
})

// Last in the file on purpose: the update store is module state, and a
// session marked stale stays stale for every test after it.
describe('what intent renders ahead of the click', () => {
  // On an iPhone with everything prefetched, a first visit to the landing
  // page was 107 ms from tap to paint: 4 decoding, 87 rendering. A page
  // still held from before was 15 ms - a reveal. So intent renders the page
  // hidden, and the click reveals it.
  let prerendered: [string, number][] = []

  function serverAnswering(answers: Record<string, { depth?: string; redirect?: string; slot?: string }>) {
    ;(globalThis as { fetch: unknown }).fetch = (input: unknown) => {
      const url = new URL(String(input), 'https://example.test').pathname
      sent.push({ url })
      const a = answers[url] ?? {}
      const headers: Record<string, string> = { 'Content-Type': 'text/x-component', 'X-RSC-Layouts': 'app/layout' }

      if (a.redirect) headers['X-RSC-Redirect'] = a.redirect
      if (a.slot) headers['X-RSC-Revalidate'] = a.slot
      headers['X-RSC-Segment-Depth'] = a.depth ?? '1'

      return Promise.resolve(new Response(a.redirect ? null : url, { status: a.redirect ? 204 : 200, headers }))
    }
  }

  beforeEach(() => {
    prerendered = []
    setHeldLayouts(['app/layout'])
    setPrerenderHandler((_tree, key, depth) => prerendered.push([key, depth]))
  })

  afterEach(() => {
    setPrerenderHandler(null)
    setHeldLayouts([])
  })

  test('a segment, once decoded, is handed to the boundary at its depth', async () => {
    serverAnswering({ '/page': { depth: '1' } })

    prefetch('/page', undefined, true)
    await new Promise((r) => setTimeout(r, 30))

    expect(prerendered).toEqual([['/page', 1]])
  })

  test('not without intent: a link that only came into view is bytes, not a render', async () => {
    serverAnswering({ '/page': { depth: '1' } })

    prefetch('/page')
    await new Promise((r) => setTimeout(r, 30))

    expect(prerendered).toEqual([])
  })

  test('not a whole document, which would replace the root, nor a slot, which is a region of a page not on screen', async () => {
    serverAnswering({ '/doc': { depth: '0' }, '/modal': { depth: '1', slot: 'modal' } })

    prefetch('/doc', undefined, true)
    prefetch('/modal', undefined, true)
    await new Promise((r) => setTimeout(r, 30))

    expect(prerendered).toEqual([])
  })

  test('a guarded link renders where the guard sends the visitor', async () => {
    // Sign in on a landing page: the tap decoded the login page and loaded
    // its chunks after the click - 154 ms of a 225 ms tap, measured.
    serverAnswering({ '/agent': { redirect: '/login' }, '/login': { depth: '1' } })
    const decoded: string[] = []
    setDeserializer(async (stream: ReadableStream) => {
      const text = await new Response(stream).text()
      decoded.push(text)
      return text
    })

    prefetch('/agent')
    await new Promise((r) => setTimeout(r, 30))
    expect(sent.map((s) => s.url)).toEqual(['/agent', '/login'])
    expect(decoded).toEqual([])

    prefetch('/agent', undefined, true)
    await new Promise((r) => setTimeout(r, 30))

    expect(decoded).toEqual(['/login'])
    expect(prerendered).toEqual([['/login', 1]])
    expect(sent.map((s) => s.url)).toEqual(['/agent', '/login'])
  })

  test('the navigation then finds the same tree the boundary was given', async () => {
    serverAnswering({ '/page': { depth: '1' } })
    const trees: unknown[] = []
    setPrerenderHandler((tree) => trees.push(tree))
    setNavigateHandler((tree) => trees.push(tree))

    prefetch('/page', undefined, true)
    await new Promise((r) => setTimeout(r, 30))
    await navigate('/page' as never)

    expect(trees).toHaveLength(2)
    // Same object: what lets React bail out of the subtree and flip it visible.
    expect(trees[0]).toBe(trees[1])
  })
})

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
