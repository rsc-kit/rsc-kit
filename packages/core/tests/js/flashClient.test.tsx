import { registerDom } from './dom'

registerDom()

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test } from 'bun:test'
import { FLASH_COOKIE } from '../../src/flashCookie'
import { takeFlash, useFlash } from '../../src/js/useFlash'
import type { FlashMessage } from '../../src/js/useFlash'

/** The cookie flash('Saved.') then flash('Stock is low.', 'warning') sets, as the browser's jar holds it. */
const queued = () => {
  const value = encodeURIComponent(JSON.stringify([{ message: 'Saved.', kind: 'success' }, { message: 'Stock is low.', kind: 'warning' }]))

  document.cookie = `${FLASH_COOKIE}=${value}; Path=/; Max-Age=60; SameSite=Lax`
}

afterEach(() => {
  document.cookie = `${FLASH_COOKIE}=; Max-Age=0; Path=/`
})

describe('useFlash() in the browser', () => {
  test('takes each message once and clears the cookie', async () => {
    queued()

    expect(takeFlash().map((m) => m.message)).toEqual(['Saved.', 'Stock is low.'])
    expect(document.cookie).not.toContain(`${FLASH_COOKIE}=`)
    expect(takeFlash()).toEqual([])
  })

  test('hands a message over on mount and after a navigation, never twice', async () => {
    const seen: FlashMessage[] = []
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)

    function Toasts() {
      useFlash((message) => void seen.push(message))
      return null
    }

    queued()
    await act(async () => root.render(createElement(Toasts)))

    expect(seen.map((m) => m.message)).toEqual(['Saved.', 'Stock is low.'])

    // The next page's action flashes and redirects: the cookie arrives with
    // the answer, and the navigation is the moment it is taken.
    document.cookie = `${FLASH_COOKIE}=${encodeURIComponent(JSON.stringify([{ message: 'Deleted.', kind: 'success' }]))}; Path=/`
    await act(async () => void window.dispatchEvent(new CustomEvent('rsc-navigate', { detail: '/products' })))
    await act(async () => void window.dispatchEvent(new CustomEvent('rsc-navigate', { detail: '/products' })))

    expect(seen.map((m) => m.message)).toEqual(['Saved.', 'Stock is low.', 'Deleted.'])

    await act(async () => root.unmount())
    container.remove()
  })
})
