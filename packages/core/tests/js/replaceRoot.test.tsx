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
import {
  applyRevalidated,
  followActionRedirect,
  setDeserializer,
  setNavigateHandler,
  setReplaceRootHandler,
} from '../../src/js/navigate'

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
  setNavigateHandler(null as never)
  ;(globalThis as { fetch: unknown }).fetch = realFetch
})

const realFetch = globalThis.fetch

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

describe('an action that redirects back to its own page after revalidate("all")', () => {
  test('the page is rendered in place: no fallback, and the form keeps its state', async () => {
    history.replaceState({}, '', '/settings/profile')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root.render(<ActivityRoot initialKey="/settings/profile" initialTree={page(Promise.resolve())} />)
    })
    await act(async () => {
      await later(10)
    })
    await act(async () => {
      ;(window as unknown as { __set: (v: string) => void }).__set('typed')
    })

    // revalidate('all') asks for the layouts, so the page arrives whole -
    // depth 0 - with the layout's boundary still waiting on the session.
    const pending = later(40)

    setDeserializer(async () => page(pending))
    ;(globalThis as { fetch: unknown }).fetch = async () =>
      new Response('whole', {
        headers: { 'Content-Type': 'text/x-component', 'X-RSC-Segment-Depth': '0' },
      })

    await act(async () => {
      await followActionRedirect('/settings/profile', ['all'])
    })

    // Not the fallback: a profile saved showed the app shell's skeleton over
    // the whole page, because the page was mounted again as a new one.
    expect(container.querySelector('#fallback')).toBeNull()
    expect(container.querySelector('input')!.getAttribute('data-value')).toBe('typed')

    await act(async () => {
      await pending
      await later(10)
    })

    expect(container.querySelector('#fallback')).toBeNull()
  })
})
