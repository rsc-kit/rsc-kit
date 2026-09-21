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
import { EARLY_CLICKS, replayEarlyClicks } from '../../src/js/earlyClicks'

declare global {
  interface Window {
    __rsc_early?: { q: string[]; stop(): void }
    __rsc_navigate?: unknown
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
