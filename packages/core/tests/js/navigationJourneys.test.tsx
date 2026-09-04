/**
 * Whole navigation journeys, driven through the real router.
 *
 * Every navigation bug this feature produced lived in a journey rather than a
 * unit: hover-then-click lost the segment depth and rendered a page with no
 * layouts; visiting a section with its own layout wiped retention on the way
 * in; going back from one refused to restore. The store, the boundary and the
 * depth arithmetic each passed their own tests throughout.
 *
 * So this drives navigate.ts itself — its prefetch cache, its history handling,
 * its restore path — against a server that answers the segment protocol the
 * way the host does. Only the transport and the Flight encoding are stood in
 * for; the routing is the real thing.
 */

import { registerDom } from './dom'

registerDom()

import { act, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  navigate,
  prefetch,
  refresh,
  setCallServer,
  setDeserializer,
  setHeldLayouts,
  setInterceptManifest,
  setNavigateHandler,
  setRestoreHandler,
  setStaticPayloads,
  setStaticRoutes,
} from '../../src/js/navigate.ts'
import { SegmentBoundary } from '../../src/js/SegmentBoundary.tsx'
import { SlotBoundary } from '../../src/js/SlotBoundary.tsx'
import { clearSegments, restoreSegments, setSegment } from '../../src/js/segmentStore.ts'

// ── The app the server renders ───────────────────────────────────────────────

const ROUTES: Record<string, string[]> = {
  '/a': ['app/layout', 'app/docs/layout'],
  '/b': ['app/layout', 'app/docs/layout'],
  // A section with a layout of its own: the shared depth is less than either
  // chain, which is the shape that broke retention.
  '/deep': ['app/layout', 'app/docs/layout', 'app/docs/deep/layout'],
  // Shares only the root.
  '/other': ['app/layout', 'app/other/layout'],
  // Lives under /deep's layout, and is intercepted into that layout's slot.
  '/deep/item/1': ['app/layout', 'app/docs/layout', 'app/docs/deep/layout'],
  // Its own root layout, sharing nothing — a route group with separate chrome,
  // which is how a route escapes the layout that would force a runtime on it.
  '/marketing': ['app/(marketing)/layout'],
}

/** The layout that declares the intercepted slot, and so renders it. */
const SLOT_OWNER_DEPTH = 2

/** A page with state a user would be annoyed to lose. */
function Page({ id }: { id: string }) {
  const [value, setValue] = useState('')

  return (
    <div data-page={id}>
      <input
        aria-label={id}
        value={value}
        onChange={(e) => setValue((e.target as HTMLInputElement).value)}
      />
    </div>
  )
}

/** Mirrors buildElement: layouts from `from` down, each wrapping a boundary. */
function renderRoute(url: string, from: number): ReactNode {
  const chain = ROUTES[url]
  let element: ReactNode = <Page id={url} />

  for (let i = chain.length - 1; i >= from; i--) {
    element = (
      <div data-layout={chain[i]}>
        {/* The layout that declares the slot renders it, filled with its
            default until something intercepts into it. */}
        {i + 1 === SLOT_OWNER_DEPTH && (
          <SlotBoundary name="modal">
            <span data-slot="default" />
          </SlotBoundary>
        )}
        <SegmentBoundary depth={i + 1} pageKey={url}>
          {element}
        </SegmentBoundary>
      </div>
    )
  }

  return element
}

// ── A server that speaks the segment protocol ────────────────────────────────

let requests: Array<{ url: string; held: string | null; depth: number }> = []
/**
 * The depth each navigation actually applied at.
 *
 * A payload that came from the prefetch cache makes no request, so asserting
 * on the last request would be asserting on the prefetch — and would pass
 * whatever the close then did with it.
 */
let applied: Array<{ key: string; depth: number }> = []

function sharedDepth(held: string | null, chain: string[]): number {
  if (!held) return 0

  const heldChain = held.split(',')
  let depth = 0

  for (const [i, component] of chain.entries()) {
    if (heldChain[i] !== component) break
    depth++
  }

  return depth
}

function installServer() {
  ;(globalThis as { fetch: unknown }).fetch = async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = new URL(String(input), 'https://example.test').pathname
    const held = init?.headers?.['X-RSC-Segments'] ?? null
    const chain = ROUTES[url]

    if (!chain) throw new Error(`no route for ${url}`)

    // An interceptor replaces a slot on the layout that declares it, so the
    // render has to reach that layout however much the client already holds.
    const intercepting = init?.headers?.['X-RSC-Intercept'] !== undefined
    const depth = intercepting
      ? Math.min(sharedDepth(held, chain), SLOT_OWNER_DEPTH)
      : sharedDepth(held, chain)

    requests.push({ url, held, depth })

    return new Response(`${url}|${depth}`, {
      headers: {
        'Content-Type': 'text/x-component',
        'X-RSC-Segment-Depth': String(depth),
        'X-RSC-Layouts': chain.join(','),
      },
    })
  }
}

// ── The client, wired the way createViteRscApp wires it ──────────────────────

let container: HTMLElement
let root: ReturnType<typeof createRoot>
let setRootTree: ((tree: ReactNode) => void) | null = null

function Root({ initial }: { initial: ReactNode }) {
  const [tree, setTree] = useState<ReactNode>(initial)

  useEffect(() => {
    setRootTree = setTree
  }, [])

  return tree
}

async function boot(url: string) {
  history.replaceState({}, '', url)

  setDeserializer(async (stream: ReadableStream) => {
    const body = await new Response(stream).text()

    // A host that answers an interception with the interceptor alone marks it
    // as such; everything else is a page at some depth.
    if (body.startsWith('slot:')) return <span data-slot={body.slice(5)} />

    const [page, depth] = body.split('|')

    return renderRoute(page, Number(depth))
  })
  setCallServer(async () => null)

  setNavigateHandler((tree, key, segmentDepth) => {
    applied.push({ key, depth: segmentDepth })

    if (segmentDepth > 0) {
      setSegment(segmentDepth, key, tree as ReactNode)

      return
    }

    clearSegments()
    setRootTree?.(tree as ReactNode)
  })
  setRestoreHandler((key) => restoreSegments(key))
  setInterceptManifest([{ urlPattern: '/deep/item/[id]', slot: 'modal' }])
  setHeldLayouts(ROUTES[url])

  await act(async () => {
    root.render(<Root initial={renderRoute(url, 0)} />)
  })
}

/** What the browser's back button does. */
async function back(url: string) {
  await act(async () => {
    await navigate(url, { replace: true, restore: true })
  })
}

async function go(url: string) {
  await act(async () => {
    await navigate(url)
  })
}

/**
 * Retained pages stay in the DOM, so presence is not the question.
 *
 * happy-dom has no layout engine and reports client rects for hidden elements
 * too, so visibility is read from the inline display Activity sets rather than
 * from geometry.
 */
function hidden(el: Element): boolean {
  let node: HTMLElement | null = el as HTMLElement

  while (node && node !== container) {
    if (node.style?.display === 'none') return true
    node = node.parentElement
  }

  return false
}

function visiblePage(): string | null {
  const shown = [...container.querySelectorAll('[data-page]')].find((el) => !hidden(el))

  return shown?.getAttribute('data-page') ?? null
}

function field(id: string): HTMLInputElement | null {
  return [...container.querySelectorAll<HTMLInputElement>(`input[aria-label="${id}"]`)].find((el) => !hidden(el)) ?? null
}

async function type(id: string, value: string) {
  const el = field(id)!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  clearSegments()
  requests = []
  applied = []
  installServer()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  clearSegments()
  setRootTree = null
})

// ── The journeys ─────────────────────────────────────────────────────────────

describe('moving between pages under the same layouts', () => {
  test('sends only the page and leaves the layouts mounted', async () => {
    await boot('/a')
    await go('/b')

    expect(requests.at(-1)).toMatchObject({ url: '/b', depth: 2 })
    expect(visiblePage()).toBe('/b')
    // The chrome above the boundary was never resent, so it is still the
    // element that was hydrated.
    expect(container.querySelector('[data-layout="app/layout"]')).not.toBeNull()
  })

  test('going back restores the page with what was typed, and asks for nothing', async () => {
    await boot('/a')
    await type('/a', 'half-written')
    await go('/b')

    const before = requests.length
    await back('/a')

    expect(requests.length).toBe(before)
    expect(visiblePage()).toBe('/a')
    expect(field('/a')!.value).toBe('half-written')
  })
})

describe('a section with a layout of its own', () => {
  test('is still only sent from the layout that differs', async () => {
    await boot('/a')
    await go('/deep')

    // Two layouts shared of three: the payload starts at the third.
    expect(requests.at(-1)).toMatchObject({ url: '/deep', depth: 2 })
    expect(visiblePage()).toBe('/deep')
  })

  test('going back to a shallower page keeps its state', async () => {
    // The reported bug: the deeper section adds a boundary the shallower page
    // never had, and returning refused to restore because of it.
    await boot('/a')
    await type('/a', 'still here')
    await go('/deep')

    const before = requests.length
    await back('/a')

    expect(requests.length).toBe(before)
    expect(visiblePage()).toBe('/a')
    expect(field('/a')!.value).toBe('still here')
  })

  test('and can be returned to afterwards', async () => {
    await boot('/a')
    await go('/deep')
    await back('/a')
    await back('/deep')

    expect(visiblePage()).toBe('/deep')
  })
})

describe('a section sharing only the root layout', () => {
  test('is sent from the layout that differs, not as a whole document', async () => {
    await boot('/a')
    await go('/other')

    expect(requests.at(-1)).toMatchObject({ url: '/other', depth: 1 })
    expect(visiblePage()).toBe('/other')
  })
})

describe('a prefetched navigation', () => {
  test('renders with its layouts, not as a bare page', async () => {
    // A prefetch goes out with the chain held, so it comes back partial. Losing
    // that depth on the cache hit replaced the root with a page that had no
    // layouts — content on a blank screen, and only after a hover.
    await boot('/a')

    await act(async () => {
      prefetch('/b')
      await new Promise((r) => setTimeout(r, 0))
    })

    const afterPrefetch = requests.length
    await go('/b')

    // Served from cache: no second request.
    expect(requests.length).toBe(afterPrefetch)
    expect(visiblePage()).toBe('/b')
    expect(container.querySelector('[data-layout="app/layout"]')).not.toBeNull()
  })

  test('is refetched when the held chain has moved on since', async () => {
    await boot('/a')

    await act(async () => {
      prefetch('/b')
      await new Promise((r) => setTimeout(r, 0))
    })

    // Go somewhere with a different chain first: the cached partial was
    // rendered against the old one and no longer composes.
    await go('/other')

    const before = requests.length
    await go('/b')

    expect(requests.length).toBeGreaterThan(before)
    expect(visiblePage()).toBe('/b')
  })
})

describe('opening and leaving an intercepted view', () => {
  test('the interceptor is rendered by the layout that declares its slot', async () => {
    await boot('/deep')
    await go('/deep/item/1')

    // Not the deepest shared layout: the one that owns the slot.
    expect(requests.at(-1)).toMatchObject({ url: '/deep/item/1', depth: SLOT_OWNER_DEPTH })
  })

  test('leaving it re-renders that layout, so the slot can empty again', async () => {
    // Claiming the whole chain would replace only the page below the layout,
    // leaving the interceptor in its slot — the modal stayed open over the
    // page behind it while the URL had already changed.
    await boot('/deep')
    await go('/deep/item/1')
    await go('/deep')

    const leaving = requests.at(-1)!

    expect(leaving.url).toBe('/deep')
    expect(leaving.depth).toBeLessThanOrEqual(SLOT_OWNER_DEPTH)
    // The claim itself is what forces it: fewer layouts than are mounted.
    expect(leaving.held!.split(',').length).toBeLessThanOrEqual(SLOT_OWNER_DEPTH)
  })

  test('an ordinary navigation afterwards claims the whole chain again', async () => {
    await boot('/deep')
    await go('/deep/item/1')
    await go('/deep')
    await go('/deep/item/1')
    await go('/deep')

    // The narrowing applies to leaving an interception, not to everything after.
    expect(requests.at(-1)!.held!.split(',').length).toBeLessThanOrEqual(SLOT_OWNER_DEPTH)
  })

  test('a link hovered inside the modal does not defeat the close', async () => {
    // A pointer hovers Close before clicking it, which a scripted click never
    // does. The prefetch has to be recorded against the chain the close will
    // claim, not the one mounted — otherwise reusing it skips the layout
    // holding the modal and the URL changes with the modal still over the page.
    //
    // Asserted on the depth applied rather than the last request: the close
    // reuses the prefetch and issues none, so the last request is the
    // prefetch's and would pass whatever the close did with it.
    await boot('/deep')
    await go('/deep/item/1')

    await act(async () => {
      prefetch('/deep')
      await new Promise((r) => setTimeout(r, 0))
    })

    await go('/deep')

    expect(applied.at(-1)!.depth).toBeLessThanOrEqual(SLOT_OWNER_DEPTH)
  })

  test('and the prefetch it fired is not simply thrown away', async () => {
    // The close claims fewer layouts than are held, so a prefetch recorded
    // against the held chain can never match and the payload is refetched from
    // scratch — a request made, paid for, and discarded every time, on the one
    // navigation a modal guarantees the user will make.
    await boot('/deep')
    await go('/deep/item/1')

    const before = requests.length

    await act(async () => {
      prefetch('/deep')
      await new Promise((r) => setTimeout(r, 0))
    })

    await go('/deep')

    expect(requests.length - before).toBe(1)
  })
})

describe('a route with its own root layout', () => {
  test('is sent as a whole document, since nothing is shared', async () => {
    await boot('/a')
    await go('/marketing')

    expect(requests.at(-1)).toMatchObject({ url: '/marketing', depth: 0 })
    expect(visiblePage()).toBe('/marketing')
  })

  test('renders through the router with no special handling', async () => {
    // Nothing has to know the route ships no JS of its own: a visitor already
    // inside the app has the runtime loaded, and a depth-0 payload replaces the
    // root the way any other whole document would. The saving is for someone
    // landing on it directly, who downloads none of it.
    await boot('/a')
    await go('/marketing')

    expect(container.querySelector('[data-layout="app/(marketing)/layout"]')).not.toBeNull()
    expect(container.querySelector('[data-layout="app/layout"]')).toBeNull()
  })

  test('and can be navigated back out of', async () => {
    await boot('/a')
    await go('/marketing')
    await go('/a')

    expect(visiblePage()).toBe('/a')
  })
})

describe('asking for the page again', () => {
  test('re-renders the page and leaves the layouts mounted', async () => {
    // The cheap form: what is already on screen above the page stays, so the
    // server only has to produce what changed.
    await boot('/a')
    await go('/b')

    const before = requests.length
    await act(async () => {
      await refresh()
    })

    const asked = requests.at(-1)!

    expect(requests.length).toBe(before + 1)
    expect(asked.url).toBe('/b')
    expect(asked.held!.split(',')).toEqual(ROUTES['/b'])
  })

  test('adds no history entry, because you have not gone anywhere', async () => {
    await boot('/a')
    await go('/b')

    const entries = history.length
    await act(async () => {
      await refresh()
    })

    expect(history.length).toBe(entries)
    expect(window.location.pathname).toBe('/b')
  })

  test('ignores a prefetched copy, since that is what the server said before', async () => {
    // Refreshing is a request for what is true now. Serving it from the cache
    // would answer with the very thing being refreshed.
    await boot('/a')

    await act(async () => {
      prefetch('/a')
      await new Promise((r) => setTimeout(r, 0))
    })

    const afterPrefetch = requests.length
    await act(async () => {
      await refresh()
    })

    expect(requests.length).toBe(afterPrefetch + 1)
  })

  test('full gives up the chain, so the layouts are re-rendered too', async () => {
    // A count in a layout does not move on an ordinary refresh — the layout
    // was never asked for. This is how you ask.
    await boot('/a')
    await go('/b')

    await act(async () => {
      await refresh('all')
    })

    const asked = requests.at(-1)!

    expect(asked.held).toBeNull()
    expect(asked.depth).toBe(0)
  })

  test('a full refresh keeps you on the same url', async () => {
    await boot('/a')
    await go('/deep')

    await act(async () => {
      await refresh('all')
    })

    expect(window.location.pathname).toBe('/deep')
  })
})

// ── The same journeys, on a host that answers no headers ─────────────────────

describe('a site served as files', () => {
  /**
   * A file server. It has no idea what the client already holds, so it sends
   * no X-RSC-Segment-Depth and no X-RSC-Layouts — the client has to work both
   * out from the table the build inlined, and ask for the right file by name.
   */
  function installFileServer() {
    ;(globalThis as { fetch: unknown }).fetch = async (input: unknown) => {
      const path = new URL(String(input), 'https://example.test').pathname
      const match = /^(.*)\/index(?:\.seg(\d+))?\.rsc$/.exec(path)

      if (!match) throw new Error(`not a payload url: ${path}`)

      const url = match[1] || '/'
      const depth = match[2] ? Number(match[2]) : 0

      if (!ROUTES[url]) throw new Error(`no route for ${url}`)

      requests.push({ url, held: null, depth })

      // Deliberately bare: a file server sets no protocol headers at all.
      return new Response(`${url}|${depth}`, { headers: { 'Content-Type': 'text/x-component' } })
    }
  }

  const table = Object.entries(ROUTES).map(([url, layouts]) => ({
    segments: url
      .split('/')
      .filter(Boolean)
      .map((value) => ({ type: 'static' as const, value })),
    layouts,
  }))

  beforeEach(() => {
    installFileServer()
    setStaticPayloads('index.rsc')
    setStaticRoutes(table as never)
  })

  afterEach(() => {
    setStaticPayloads(null)
    setStaticRoutes([] as never)
  })

  test('asks for the variant matching what it already holds', async () => {
    // /a and /b share both layouts, so only the page changed. Asking for the
    // whole document instead replaces the root — and replacing the root on a
    // document-rooted app unmounts everything retained behind it.
    await boot('/a')
    requests = []

    await go('/b')

    expect(requests).toEqual([{ url: '/b', held: null, depth: 2 }])
    expect(applied.at(-1)).toMatchObject({ depth: 2 })
  })

  test('and asks for the whole document when it shares nothing', async () => {
    await boot('/a')
    requests = []

    await go('/marketing')

    expect(requests).toEqual([{ url: '/marketing', held: null, depth: 0 }])
  })

  test('keeps a half-typed page across a navigation and back', async () => {
    // The whole point of the depth variants: without them every navigation is
    // a whole document, and going back rebuilds the page instead of revealing
    // it.
    await boot('/a')

    const field = container.querySelector('input[aria-label="/a"]') as HTMLInputElement

    await act(async () => {
      field.value = 'half typed'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await go('/b')
    await back('/a')

    const returned = container.querySelector('input[aria-label="/a"]') as HTMLInputElement

    expect(returned.value).toBe('half typed')
    expect(hidden(returned)).toBe(false)
  })

  test('a hovered link does not poison the click that follows', async () => {
    // A prefetch is fetched against one chain and applied later. With no
    // headers to read, an entry that forgets which depth it asked for claims
    // a segment is a whole document — and rendering a layout-less page as the
    // document root does not warn, it hangs.
    await boot('/a')
    requests = []

    await act(async () => {
      prefetch('/b')
    })

    await go('/b')

    expect(applied.at(-1)).toMatchObject({ depth: 2 })
  })
})

// ── A host that answers an interception with the interceptor alone ───────────

describe('an interception that only fills the slot', () => {
  /**
   * Answers an intercepted request with the interceptor and nothing else,
   * saying so with the header that names the region.
   *
   * Re-rendering the page underneath would put the modal on screen at the
   * cost of rebuilding everything below the layout that owns the slot — so
   * opening a modal from a half-filled form throws the form away.
   */
  function installSlotHost() {
    ;(globalThis as { fetch: unknown }).fetch = async (
      input: unknown,
      init?: { headers?: Record<string, string> },
    ) => {
      const url = new URL(String(input), 'https://example.test').pathname
      const slot = init?.headers?.['X-RSC-Intercept']
      const held = init?.headers?.['X-RSC-Segments'] ?? null

      requests.push({ url, held, depth: slot ? -1 : sharedDepth(held, ROUTES[url]) })

      if (slot) {
        return new Response(`slot:${url}`, {
          headers: { 'Content-Type': 'text/x-component', 'X-RSC-Revalidate': slot },
        })
      }

      const depth = sharedDepth(held, ROUTES[url])

      return new Response(`${url}|${depth}`, {
        headers: {
          'Content-Type': 'text/x-component',
          'X-RSC-Segment-Depth': String(depth),
          'X-RSC-Layouts': ROUTES[url].join(','),
        },
      })
    }
  }

  beforeEach(() => {
    installSlotHost()
  })

  test('leaves the page underneath exactly as it was', async () => {
    // The whole point. The page was never replaced, so what the user typed
    // into it is still there behind the modal.
    await boot('/deep')

    const field = container.querySelector('input[aria-label="/deep"]') as HTMLInputElement

    await act(async () => {
      field.value = 'half typed'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await go('/deep/item/1')

    const still = container.querySelector('input[aria-label="/deep"]') as HTMLInputElement

    expect(still.value).toBe('half typed')
    expect(hidden(still)).toBe(false)
  })

  test('and puts the interceptor in the slot', async () => {
    await boot('/deep')
    await go('/deep/item/1')

    expect(container.querySelector('[data-slot="/deep/item/1"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="default"]')).toBeNull()
  })

  test('closing it asks the server for nothing at all', async () => {
    // The page underneath never left, so closing is a matter of emptying the
    // slot. Fetching here would rebuild a page that is already on screen.
    await boot('/deep')
    await go('/deep/item/1')
    requests = []

    await go('/deep')

    expect(requests).toEqual([])
    expect(container.querySelector('[data-slot="default"]')).not.toBeNull()
  })

  test('and what was typed is still there after closing', async () => {
    await boot('/deep')

    const field = container.querySelector('input[aria-label="/deep"]') as HTMLInputElement

    await act(async () => {
      field.value = 'survives the modal'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await go('/deep/item/1')
    await go('/deep')

    const returned = container.querySelector('input[aria-label="/deep"]') as HTMLInputElement

    expect(returned.value).toBe('survives the modal')
  })

  test('a hovered modal link still opens as a modal when clicked', async () => {
    // A prefetch is a real request and comes back as the interceptor alone.
    // An entry that forgets which region it holds is applied as a whole
    // document, and the modal renders *as* the page with nothing around it.
    // Only after a hover, which is why a scripted click never finds it.
    await boot('/deep')

    await act(async () => {
      prefetch('/deep/item/1')
    })

    await go('/deep/item/1')

    // The page it opened over is still there, and the interceptor is in the
    // slot rather than standing in for the whole page.
    expect(container.querySelector('input[aria-label="/deep"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="/deep/item/1"]')).not.toBeNull()
  })

  test('and still does when the click beats the prefetch', async () => {
    // The prefetch fills in what its payload is when the response lands, and a
    // click can land first. Reading that before it settles leaves the entry
    // saying "whole document", so the modal renders as the page — which is
    // what a real hover-then-click does and an awaited prefetch never does.
    await boot('/deep')

    // Deliberately not awaited: still in flight when the navigation starts.
    prefetch('/deep/item/1')

    await go('/deep/item/1')

    expect(container.querySelector('input[aria-label="/deep"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="/deep/item/1"]')).not.toBeNull()
  })

  test('leaving to somewhere else is an ordinary navigation', async () => {
    // Only the url the modal was opened over is free to return to; anything
    // else still has to be fetched, and the slot still has to empty.
    await boot('/deep')
    await go('/deep/item/1')
    requests = []

    await go('/other')

    expect(requests.map((r) => r.url)).toEqual(['/other'])
    expect(container.querySelector('[data-slot="/deep/item/1"]')).toBeNull()
  })
})
