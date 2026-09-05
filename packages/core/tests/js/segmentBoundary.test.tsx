/**
 * The boundary rendered for real.
 *
 * The store's unit tests cannot see the failure that matters most here:
 * useSyncExternalStore compares snapshots by identity, so a getSnapshot that
 * builds a fresh object reads as "changed" on every render and loops until
 * React gives up. That only shows when something actually renders it — it
 * reached the browser as a blank page and React error #185.
 */

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SegmentBoundary } from '../../src/js/SegmentBoundary'
import { clearSegments, restoreSegments, setSegment } from '../../src/js/segmentStore'
import { useState } from 'react'

function Field({ label }: { label: string }) {
  const [value, setValue] = useState('')

  return (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => setValue((e.target as HTMLInputElement).value)}
    />
  )
}

let container: HTMLElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  clearSegments()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  clearSegments()
})

function input(label: string): HTMLInputElement | null {
  return container.querySelector(`input[aria-label="${label}"]`)
}

async function type(label: string, value: string) {
  const el = input(label)!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('rendering', () => {
  test('mounts without looping and shows the server children', async () => {
    // A fresh snapshot object per read would blow the update depth here.
    await act(async () => {
      root.render(
        <SegmentBoundary depth={1} pageKey="/a">
          <Field label="a" />
        </SegmentBoundary>,
      )
    })

    expect(input('a')).not.toBeNull()
  })

  test('renders a stored segment instead of the children', async () => {
    await act(async () => {
      root.render(
        <SegmentBoundary depth={1} pageKey="/a">
          <Field label="a" />
        </SegmentBoundary>,
      )
    })

    await act(async () => setSegment(1, '/b', <Field label="b" />))

    expect(input('b')).not.toBeNull()
  })
})

describe('returning to a page', () => {
  test('brings back what the user had typed', async () => {
    await act(async () => {
      root.render(
        <SegmentBoundary depth={1} pageKey="/a">
          <Field label="a" />
        </SegmentBoundary>,
      )
    })

    await type('a', 'half-written')

    await act(async () => setSegment(1, '/b', <Field label="b" />))
    expect(input('b')).not.toBeNull()

    await act(async () => {
      expect(restoreSegments('/a')).toBe(true)
    })

    // The page it arrived on was seeded from the server children, so it is
    // still mounted — hidden — with its state.
    expect(input('a')!.value).toBe('half-written')
  })

  test('keeps a page it navigated to, not just the one it arrived on', async () => {
    await act(async () => {
      root.render(
        <SegmentBoundary depth={1} pageKey="/a">
          <Field label="a" />
        </SegmentBoundary>,
      )
    })

    await act(async () => setSegment(1, '/b', <Field label="b" />))
    await type('b', 'typed on b')
    await act(async () => setSegment(1, '/c', <Field label="c" />))

    await act(async () => {
      expect(restoreSegments('/b')).toBe(true)
    })

    expect(input('b')!.value).toBe('typed on b')
  })
})
