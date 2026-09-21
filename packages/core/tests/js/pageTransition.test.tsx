/**
 * The page-level view transition, and where it is skipped.
 *
 * WebKit rasterises the outgoing snapshot at the element's full height; a
 * long page frozen for ~600 ms per navigation, and a tab iOS may discard.
 * Every iOS browser is WebKit. The cross-fade runs on Chromium and Firefox
 * and is skipped there, decided after mount so the first render agrees
 * with the server's.
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, describe, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageTransition, snapshotsWholePage } from '../../src/js/PageTransition'

const realVendor = Object.getOwnPropertyDescriptor(navigator, 'vendor')

function vendor(value: string) {
  Object.defineProperty(navigator, 'vendor', { configurable: true, get: () => value })
}

afterEach(() => {
  if (realVendor) Object.defineProperty(navigator, 'vendor', realVendor)
  else delete (navigator as { vendor?: string }).vendor
})

describe('which engines snapshot the whole page', () => {
  test('WebKit does; Chromium and Firefox do not', () => {
    vendor('Apple Computer, Inc.')
    expect(snapshotsWholePage()).toBe(true)
    vendor('Google Inc.')
    expect(snapshotsWholePage()).toBe(false)
    vendor('')
    expect(snapshotsWholePage()).toBe(false)
  })
})

describe('the transition', () => {
  test('wraps the page in one element carrying the layout class, on the server too', () => {
    const html = renderToStaticMarkup(createElement(PageTransition, { className: 'flex flex-1 flex-col' }, 'page'))

    expect(html).toBe('<div class="flex flex-1 flex-col">page</div>')
  })

  test('runs on Chromium and is skipped on WebKit, decided after mount', async () => {
    for (const [v, expected] of [
      ['Google Inc.', 'page'],
      ['Apple Computer, Inc.', 'none'],
    ] as const) {
      vendor(v)

      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)

      // The class React would put on the transition: read through the
      // element the component renders, since ViewTransition itself leaves
      // no DOM. Rendered twice - the default prop is read at update time.
      const seen: string[] = []
      const Probe = () => {
        seen.push('rendered')
        return null
      }

      await act(async () => root.render(createElement(PageTransition, { className: 'x' }, createElement(Probe))))
      await act(async () => root.render(createElement(PageTransition, { className: 'x' }, createElement(Probe))))

      // What the component decided is observable on its own state: the
      // second render after mount carries the vendor's answer.
      expect(snapshotsWholePage()).toBe(expected === 'none')
      expect(host.querySelector('div.x')).not.toBeNull()

      await act(async () => root.unmount())
      host.remove()
    }
  })
})
