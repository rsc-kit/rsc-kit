/**
 * The whole document rendered again in place - revalidate("all") - through
 * the root the hydrated app runs under.
 */

import { registerDom } from './dom'

registerDom()

import { Suspense, act, use, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test } from 'bun:test'
import { ActivityRoot } from '../../src/js/ActivityRouter'
import { applyRevalidated, setReplaceRootHandler } from '../../src/js/navigate'

function Field() {
  const [value, setValue] = useState('')

  ;(window as unknown as { __set: (v: string) => void }).__set = setValue

  return <input aria-label="field" value={value} readOnly data-value={value} />
}

function Slow({ data }: { data: Promise<void> }) {
  use(data)

  return (
    <main>
      <Field />
    </main>
  )
}

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** The page as a document renders it: the form behind a boundary whose data is still coming. */
const page = (data: Promise<void>) => (
  <Suspense fallback={<p id="fallback">loading</p>}>
    <Slow data={data} />
  </Suspense>
)

let container: HTMLElement
let root: ReturnType<typeof createRoot>

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  setReplaceRootHandler(null)
})

describe('revalidate("all") through the root', () => {
  test('a boundary still waiting keeps the page on screen, and the form under it keeps its state', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(<ActivityRoot initialKey="/doc" initialTree={page(Promise.resolve())} />)
    })
    await act(async () => {
      await later(10)
    })
    await act(async () => {
      ;(window as unknown as { __set: (v: string) => void }).__set('typed')
    })
    expect(container.querySelector('input')!.getAttribute('data-value')).toBe('typed')

    // The document again, with the boundary's row not yet arrived.
    const pending = later(40)
    // What an action's answer does with its "all" tree, through the handler
    // ActivityRoot registered on mount.
    await act(async () => {
      applyRevalidated('all', page(pending))
    })

    // Not the fallback: what was on screen stays until the row lands.
    expect(container.querySelector('#fallback')).toBeNull()
    expect(container.querySelector('input')!.getAttribute('data-value')).toBe('typed')

    await act(async () => {
      await pending
      await later(10)
    })

    expect(container.querySelector('#fallback')).toBeNull()
    expect(container.querySelector('input')!.getAttribute('data-value')).toBe('typed')
  })
})
