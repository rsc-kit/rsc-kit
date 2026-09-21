/**
 * The page-level view transition, and where it is skipped.
 *
 * WebKit rasterises the outgoing snapshot at the element's full height; a
 * long page frozen for 600-900 ms per navigation, and a tab iOS may discard.
 * Every iOS browser is WebKit. The cross-fade runs on Chromium and Firefox
 * and is skipped there, decided after mount so the first render agrees
 * with the server's - and the test watches the browser API itself, not the
 * component's opinion of it.
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as React from 'react'
import { act, createElement, startTransition, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageTransition, pageTransitionCss, prefersReducedMotion, snapshotsWholePage } from '../../src/js/PageTransition'

const realVendor = Object.getOwnPropertyDescriptor(navigator, 'vendor')
const realMatchMedia = window.matchMedia
let started = 0

function vendor(value: string) {
  Object.defineProperty(navigator, 'vendor', { configurable: true, get: () => value })
}

function reducedMotion(on: boolean) {
  ;(window as any).matchMedia = (q: string) => ({ matches: q.includes('reduced-motion') ? on : false })
}

beforeEach(() => {
  started = 0
  reducedMotion(false)
  // What React calls when a boundary with a class other than 'none' is
  // part of a transition. Counted; the callback is run so the update lands.
  ;(document as any).startViewTransition = (cb: () => void) => {
    started++
    cb()
    return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), skipTransition() {} }
  }
})

afterEach(() => {
  if (realVendor) Object.defineProperty(navigator, 'vendor', realVendor)
  else delete (navigator as { vendor?: string }).vendor
  window.matchMedia = realMatchMedia
  delete (document as any).startViewTransition
})

const addTransitionType: (type: string) => void =
  (React as any).addTransitionType ?? (React as any).unstable_addTransitionType

/** A page under the transition, replaced the way a navigation replaces it. */
function App({ webkit }: { webkit?: 'skip' | 'run' }) {
  const [page, setPage] = useState('a')
  ;(window as any).__go = (next: string) => {
    startTransition(() => {
      addTransitionType('rsc-navigation')
      setPage(next)
    })
  }

  return createElement(PageTransition, { className: 'x', webkit, children: createElement('main', { key: page }, page) })
}

async function navigateOnce(webkit?: 'skip' | 'run'): Promise<number> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => root.render(createElement(App, { webkit })))
  // The decision is made in an effect after mount; a second commit lets it land.
  await act(async () => {})
  started = 0
  await act(async () => (window as any).__go('b'))
  const count = started

  await act(async () => root.unmount())
  host.remove()

  return count
}

describe('which engines snapshot the whole page', () => {
  test('WebKit does, wherever it runs; Chromium and Firefox do not', () => {
    vendor('Apple Computer, Inc.')
    expect(snapshotsWholePage()).toBe(true)
    vendor('Google Inc.')
    expect(snapshotsWholePage()).toBe(false)
    vendor('')
    expect(snapshotsWholePage()).toBe(false)
  })
})

describe('the transition', () => {
  test('wraps the page in one element carrying the layout class, with its css, on the server too', () => {
    const html = renderToStaticMarkup(createElement(PageTransition, { className: 'flex flex-1 flex-col', children: 'page' }))

    expect(html).toContain('<div class="flex flex-1 flex-col">')
    expect(html).toContain('page</div>')
    expect(html).toContain('::view-transition{pointer-events:none}')
  })

  test('runs on Chromium', async () => {
    vendor('Google Inc.')

    expect(await navigateOnce()).toBe(1)
  })

  test('is skipped on WebKit: no transition is started, so nothing is snapshotted', async () => {
    vendor('Apple Computer, Inc.')

    expect(await navigateOnce()).toBe(0)
  })

  test('unless the app says WebKit may run it', async () => {
    vendor('Apple Computer, Inc.')

    expect(await navigateOnce('run')).toBe(1)
  })

  test('and is skipped for a visitor who asked for reduced motion, on any engine', async () => {
    vendor('Google Inc.')
    reducedMotion(true)

    expect(prefersReducedMotion()).toBe(true)
    expect(await navigateOnce()).toBe(0)
  })
})

describe('the css that travels with it', () => {
  test('times the group and root pairs with the page pair, lets taps through, and honours reduced motion', () => {
    const css = pageTransitionCss('page', 120)

    // The group and root pairs kept the browser's 250 ms whatever the page
    // pair was set to, so a "120 ms" fade ran 290.
    expect(css).toContain('::view-transition-old(.page),::view-transition-new(.page),::view-transition-group(*),::view-transition-old(root),::view-transition-new(root){animation-duration:120ms}')
    // The pseudo-element tree sits over the document while it runs and
    // swallowed a second tap.
    expect(css).toContain('::view-transition{pointer-events:none}')
    expect(css).toContain('@media (prefers-reduced-motion:reduce)')
  })
})
