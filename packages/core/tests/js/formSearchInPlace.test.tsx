/**
 * A GET form whose action is the page on screen searches in place.
 *
 * `/lookup` with a box that submits to `/lookup` has no other page whose shell
 * could stand in while the query runs: the shell is this page, emptied, so
 * showing it first was a skeleton over a page that was already there, and the
 * results arrived as a second page mounted beside it. The page stays instead,
 * results and all, and the form says it is working until the new ones commit.
 */

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import Form from '../../src/js/Form'

type Call = { url: string; replace: boolean; inPlace: boolean }

let navigated: Call[] = []
let prefetchedUrls: string[] = []
let cached: Set<string>
let settle: () => void = () => {}
let rejectWith: unknown = null

beforeEach(() => {
  history.replaceState({}, '', '/lookup?q=alpha')
  navigated = []
  prefetchedUrls = []
  cached = new Set()
  rejectWith = null
  ;(window as any).__rsc_prefetch = (u: string) => {
    prefetchedUrls.push(u)
    cached.add(u)
  }
  // Even a shell somebody fetched is not shown: the page is already there.
  ;(window as any).__rsc_is_prefetched = () => true
  ;(window as any).__rsc_navigate = (u: string, o?: { replace?: boolean; inPlace?: boolean }) => {
    navigated.push({ url: u, replace: Boolean(o?.replace), inPlace: Boolean(o?.inPlace) })

    // Only a search in place is held open; a shell is a cache hit.
    if (!o?.inPlace) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      settle = () => (rejectWith ? reject(rejectWith) : resolve())
    })
  }
})

// React runs every pending async action in one lane, so a navigation a test
// left open would hold the next test's form pending too.
afterEach(async () => {
  await act(async () => {
    settle()
    await new Promise((r) => setTimeout(r, 10))
  })
  settle = () => {}
})

async function renderForm(props: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)

  await act(async () => {
    createRoot(container).render(
      <Form action="/lookup" {...props}>
        {({ pending }: { pending: boolean }) => (
          <>
            <input name="q" defaultValue="beta" />
            <button type="submit">{pending ? 'Searching…' : 'Search'}</button>
          </>
        )}
      </Form>,
    )
  })

  return container
}

async function submit(form: Element) {
  await act(async () => {
    form.dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
}

describe('submitting a GET form to the page it is on', () => {
  test('asks for the query in place, once, with no shell first', async () => {
    const form = (await renderForm()).querySelector('form')!

    await submit(form)

    expect(navigated).toEqual([{ url: '/lookup?q=beta', replace: false, inPlace: true }])
  })

  test('keeps the replace the form was given', async () => {
    const form = (await renderForm({ replace: true })).querySelector('form')!

    await submit(form)

    expect(navigated).toEqual([{ url: '/lookup?q=beta', replace: true, inPlace: true }])
  })

  test('says it is working until the results are in', async () => {
    const container = await renderForm()
    const button = container.querySelector('button')!

    expect(button.textContent).toBe('Search')

    await submit(container.querySelector('form')!)

    expect(button.textContent).toBe('Searching…')
    expect(container.querySelector('form')!.hasAttribute('data-pending')).toBe(true)

    await act(async () => {
      settle()
      await new Promise((r) => setTimeout(r, 30))
    })

    expect(button.textContent).toBe('Search')
  })

  test('is working no longer when the navigation fails, and the page is left as it was', async () => {
    const container = await renderForm()

    await submit(container.querySelector('form')!)

    rejectWith = new Error('offline')

    await act(async () => {
      settle()
      await new Promise((r) => setTimeout(r, 30))
    })

    expect(container.querySelector('button')!.textContent).toBe('Search')
  })

  test('does not fetch the page it is on for a hover, or on mount', async () => {
    const container = await renderForm({ prefetch: 'mount' })
    const form = container.querySelector('form')!

    form.dispatchEvent(new (window as any).MouseEvent('mouseover', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))

    expect(prefetchedUrls).toEqual([])
  })
})

describe('submitting a GET form to another page', () => {
  test('is not changed: its shell is shown first, then its results', async () => {
    const container = await renderForm({ action: '/search' })
    const form = container.querySelector('form')!

    form.dispatchEvent(new (window as any).MouseEvent('mouseover', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
    await submit(form)

    expect(prefetchedUrls).toEqual(['/search'])
    expect(navigated.map((n) => n.url)).toEqual(['/search', '/search?q=beta'])
    expect(navigated.map((n) => n.inPlace)).toEqual([false, false])
  })
})
