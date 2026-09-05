/**
 * Going back to a page you were just on should return you to it, not rebuild it.
 *
 * Every navigation used to call root.render(), which unmounts the previous tree
 * — and unmounting throws away client state, so a half-filled form came back
 * empty. <Activity mode="hidden"> keeps the tree mounted and its state alive.
 */

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { useActivityRouter, DEFAULT_RETENTION } from '../../src/js/ActivityRouter'
import { Activity, useState } from 'react'

/** A page with state a user would be upset to lose. */
function FormPage({ label }: { label: string }) {
  const [value, setValue] = useState('')

  return (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => setValue((e.target as HTMLInputElement).value)}
    />
  )
}

/** Drives the hook the way the real root does. */
function Harness({ onReady }: { onReady: (handle: ReturnType<typeof useActivityRouter>['handle']) => void }) {
  const { entries, activeKey, handle } = useActivityRouter({ key: '/a', tree: <FormPage label="a" /> })
  onReady(handle)

  return (
    <>
      {entries.map((entry) => (
        <Activity key={entry.key} mode={entry.key === activeKey ? 'visible' : 'hidden'}>
          {entry.tree}
        </Activity>
      ))}
    </>
  )
}

let container: HTMLElement
let root: ReturnType<typeof createRoot>
let handle: ReturnType<typeof useActivityRouter>['handle']

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root.render(<Harness onReady={(h) => (handle = h)} />)
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function input(label: string): HTMLInputElement | null {
  return container.querySelector(`input[aria-label="${label}"]`)
}

async function type(label: string, value: string) {
  const el = input(label)!

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('returning to a page', () => {
  test('keeps what the user had typed', async () => {
    await type('a', 'half-written')
    expect(input('a')!.value).toBe('half-written')

    await act(async () => handle.show('/b', <FormPage label="b" />))

    // /a is hidden, not gone.
    expect(input('b')).not.toBeNull()

    await act(async () => {
      expect(handle.restore('/a')).toBe(true)
    })

    expect(input('a')!.value).toBe('half-written')
  })

  test('restores without needing a new tree', async () => {
    await act(async () => handle.show('/b', <FormPage label="b" />))

    // The caller passes no tree — the point is that it never refetched one.
    let restored = false
    await act(async () => {
      restored = handle.restore('/a')
    })

    expect(restored).toBe(true)
    expect(input('a')).not.toBeNull()
  })

  test('reports a page it never retained, so the router fetches instead', async () => {
    let restored = true
    await act(async () => {
      restored = handle.restore('/never-visited')
    })

    expect(restored).toBe(false)
  })
})

describe('retention', () => {
  test('drops the least recently visited page past the limit', async () => {
    await type('a', 'keep me')

    for (let i = 0; i < DEFAULT_RETENTION; i++) {
      await act(async () => handle.show(`/p${i}`, <FormPage label={`p${i}`} />))
    }

    // /a fell out of the window: hidden DOM cannot grow without bound.
    let restored = true
    await act(async () => {
      restored = handle.restore('/a')
    })

    expect(restored).toBe(false)
  })

  test('revisiting a page keeps it alive', async () => {
    await type('a', 'still here')

    // Bounce between two pages more times than the retention limit. Ordering by
    // visit rather than insertion is what keeps /a from being evicted.
    for (let i = 0; i < DEFAULT_RETENTION + 2; i++) {
      await act(async () => handle.show('/b', <FormPage label="b" />))
      await act(async () => {
        if (!handle.restore('/a')) throw new Error('/a was evicted while in use')
      })
    }

    expect(input('a')!.value).toBe('still here')
  })
})
