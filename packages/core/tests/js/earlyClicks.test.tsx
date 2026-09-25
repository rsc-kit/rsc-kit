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
    __rsc_early?: { q: string[]; fq?: { f: HTMLFormElement; s: HTMLElement | null }[]; stop(): void }
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
    '<a id="blank" data-rsc target="_blank" href="/terms">Terms</a>' +
    // What React renders for a form whose action is a server action, before
    // hydration: it posts natively, with the action named in a hidden field.
    '<form id="cart" method="POST" action="/product"><input type="hidden" name="$ACTION_ID_abc" value=""><button id="add" type="submit">Add</button></form>' +
    '<form id="plain-form" method="POST" action="/search"><input name="q"><button type="submit">Go</button></form>'
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

describe('a form submitted before the router exists', () => {
  const submit = (form: HTMLFormElement) => {
    const event = new (window as any).SubmitEvent('submit', { bubbles: true, cancelable: true })

    form.dispatchEvent(event)

    return event
  }

  test("one posting a server action is held, and the browser told not to post it", () => {
    const form = document.getElementById('cart') as HTMLFormElement
    const event = submit(form)

    expect(event.defaultPrevented).toBe(true)
    expect(window.__rsc_early!.fq!.length).toBe(1)
    expect(form.hasAttribute('data-pending')).toBe(true)
  })

  test('a plain form is the browser\'s', () => {
    expect(submit(document.getElementById('plain-form') as HTMLFormElement).defaultPrevented).toBe(false)
    expect(window.__rsc_early!.fq!.length).toBe(0)
  })

  test('once hydration commits it is submitted again, to the handler React now has on it', () => {
    const form = document.getElementById('cart') as HTMLFormElement
    const resubmitted: string[] = []

    form.requestSubmit = (submitter?: HTMLElement | null) => {
      resubmitted.push(submitter?.id ?? 'form')
    }
    submit(form)

    expect(replayEarlyClicks(async () => {})).toBeNull()
    expect(resubmitted).toEqual(['form'])
    expect(form.hasAttribute('data-pending')).toBe(false)
    expect(window.__rsc_early!.fq!.length).toBe(0)
  })

  test('a tap on a link after the form wins: the visitor left it', () => {
    const form = document.getElementById('cart') as HTMLFormElement
    const resubmitted: string[] = []

    form.requestSubmit = () => {
      resubmitted.push('form')
    }
    submit(form)
    click(document.getElementById('page')!)

    const navigated: string[] = []

    expect(replayEarlyClicks(async (url) => { navigated.push(url) })).toBe('/login?next=%2Fagent')
    expect(navigated).toEqual(['/login?next=%2Fagent'])
    expect(resubmitted).toEqual([])
  })

  test('given to the browser only when the runtime never comes', () => {
    expect(EARLY_CLICKS).toContain("if(fq.length&&!w.__rsc_hydrated&&!w.__rsc_navigate)g()},3000)")
    expect(EARLY_CLICKS).toContain("if(fq.length&&!w.__rsc_hydrated)g()},15000)")
    expect(EARLY_CLICKS).toContain('HTMLFormElement.prototype.submit.call(x.f)')
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

  test('a tap held three seconds with no runtime started goes to the browser; a running one waits, up to fifteen', () => {
    // Hydration on a phone takes longer than three seconds - a port measured
    // 3.45 s - and a tap given up at three landed as a document load half a
    // second before the page would have handled it.
    expect(EARLY_CLICKS).toContain("if(q.length&&!w.__rsc_hydrated&&!w.__rsc_navigate)location.href=q[q.length-1]},3000)")
    expect(EARLY_CLICKS).toContain("if(q.length&&!w.__rsc_hydrated)location.href=q[q.length-1]},15000)")
  })
})
