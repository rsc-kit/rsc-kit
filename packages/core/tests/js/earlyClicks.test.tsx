/**
 * A tap before the runtime hydrates.
 *
 * On a phone the window between the document and a working router is
 * seconds; a tap on a link in it was the browser's, a document load of a
 * page the router would have swapped in. The bootstrap script holds it.
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { EARLY_CLICKS, afterHydration, replayEarlyClicks } from '../../src/js/earlyClicks'

declare global {
  interface Window {
    __rsc_early?: { q: string[]; stop(): void }
    __rsc_navigate?: unknown
    __rsc_hydrated?: boolean
    __rsc_on_hydrated?: () => void
  }
}

function click(el: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new (window as any).MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })

  el.dispatchEvent(event)

  return event
}

beforeEach(() => {
  history.replaceState({}, '', '/')
  document.body.innerHTML =
    '<a id="page" data-rsc href="/login?next=%2Fagent">Sign in</a>' +
    '<a id="plain" href="/api/openapi">Docs</a>' +
    '<a id="away" data-rsc href="https://elsewhere.test/x">Away</a>' +
    '<a id="blank" data-rsc target="_blank" href="/terms">Terms</a>'
  // What the bootstrap script does first, before the runtime's import.
  new Function(EARLY_CLICKS)()
})

afterEach(() => {
  window.__rsc_early?.stop()
  delete window.__rsc_early
  delete window.__rsc_navigate
  delete window.__rsc_hydrated
  delete window.__rsc_on_hydrated
  document.body.innerHTML = ''
})

describe('before the router exists', () => {
  test("a tap on this package's link is held, and the browser told not to follow it", () => {
    const event = click(document.getElementById('page')!)

    expect(event.defaultPrevented).toBe(true)
    expect(window.__rsc_early!.q).toEqual(['/login?next=%2Fagent'])
    expect(document.getElementById('page')!.hasAttribute('data-pending')).toBe(true)
  })

  test('a plain anchor, a foreign origin, a new tab and a modified click are the browser\'s', () => {
    expect(click(document.getElementById('plain')!).defaultPrevented).toBe(false)
    expect(click(document.getElementById('away')!).defaultPrevented).toBe(false)
    expect(click(document.getElementById('blank')!).defaultPrevented).toBe(false)
    expect(click(document.getElementById('page')!, { metaKey: true }).defaultPrevented).toBe(false)
    expect(window.__rsc_early!.q).toEqual([])
  })
})

describe('once the router is wired', () => {
  test('the last tap held is navigated to, and nothing further is held', async () => {
    click(document.getElementById('page')!)
    click(document.getElementById('page')!)

    const navigated: string[] = []
    const replayed = replayEarlyClicks(async (url) => {
      navigated.push(url)
    })

    expect(replayed).toBe('/login?next=%2Fagent')
    expect(navigated).toEqual(['/login?next=%2Fagent'])
    expect(window.__rsc_early!.q).toEqual([])

    // Stopped: the router's own Link handles clicks from here.
    expect(click(document.getElementById('page')!).defaultPrevented).toBe(false)
  })

  test('with nothing held, nothing happens', () => {
    const navigated: string[] = []

    expect(replayEarlyClicks(async (url) => { navigated.push(url) })).toBeNull()
    expect(navigated).toEqual([])
  })
})

describe('the moment the taps are handed over', () => {
  test('is hydration committing, not the runtime script running', () => {
    // The runtime's script runs seconds before React can dispatch a click
    // on a phone still downloading chunks. Handed over then, a tap in
    // between was nobody's - the listener gone, no fibers yet - and the
    // browser loaded the document. This is what a port saw as "still
    // reloading" on a phone after every deploy.
    const ran: string[] = []

    afterHydration(() => ran.push('replayed'))

    expect(ran).toEqual([])
    // Still held meanwhile.
    expect(click(document.getElementById('page')!).defaultPrevented).toBe(true)

    // What the outermost client component's first effect does.
    window.__rsc_hydrated = true
    window.__rsc_on_hydrated?.()

    expect(ran).toEqual(['replayed'])
  })

  test('or now, when hydration already has', () => {
    window.__rsc_hydrated = true
    const ran: string[] = []

    afterHydration(() => ran.push('now'))

    expect(ran).toEqual(['now'])
  })

  test('a tap held three seconds without hydration goes to the browser', () => {
    expect(EARLY_CLICKS).toContain("if(q.length&&!w.__rsc_hydrated)location.href=q[q.length-1]},3000)")
  })
})
