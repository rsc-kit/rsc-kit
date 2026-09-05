/**
 * A GET form shows its target route's shell while the query runs.
 *
 * The skeleton a route renders travels inside its Flight payload, so it cannot
 * be shown before that payload arrives — which is the whole problem with
 * waiting on a slow query. The route without its query *is* that skeleton, and
 * hovering the form has already fetched it, so going there first puts the page
 * on screen for free and the results replace it when they land.
 */

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, test } from 'bun:test'
import Form from '../../src/js/Form'

let navigated: Array<{ url: string; replace: boolean }> = []
let prefetchedUrls: string[] = []
let cached: Set<string>

beforeEach(() => {
  history.replaceState({}, '', '/start')
  navigated = []
  prefetchedUrls = []
  cached = new Set()
  ;(window as any).__rsc_prefetch = (u: string) => {
    prefetchedUrls.push(u)
    cached.add(u)
  }
  ;(window as any).__rsc_is_prefetched = (u: string) => cached.has(u)
  ;(window as any).__rsc_navigate = async (u: string, o?: { replace?: boolean }) => {
    navigated.push({ url: u, replace: Boolean(o?.replace) })
  }
})

async function renderForm() {
  const container = document.createElement('div')
  document.body.appendChild(container)

  await act(async () => {
    createRoot(container).render(
      <Form action="/search">
        <input name="q" defaultValue="laravel" />
        <button type="submit">go</button>
      </Form>,
    )
  })

  return container.querySelector('form')!
}

async function hover(form: Element) {
  form.dispatchEvent(new (window as any).MouseEvent('mouseover', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 20))
}

async function submit(form: Element) {
  await act(async () => {
    form.dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 30))
  })
}

describe('submitting a GET form', () => {
  test('hovering fetches the shell, not the query', async () => {
    // Running someone's search because a pointer crossed the button would make
    // the expensive half of the page the speculative half.
    const form = await renderForm()

    await hover(form)

    expect(prefetchedUrls).toEqual(['/search'])
  })

  test('shows the shell first, then the results', async () => {
    const form = await renderForm()

    await hover(form)
    await submit(form)

    expect(navigated.map((n) => n.url)).toEqual(['/search', '/search?q=laravel'])
  })

  test('the shell does not become a back-button stop of its own', async () => {
    // Two navigations, one history entry: the results replace the shell rather
    // than stacking on it, or every search would take two presses to leave.
    const form = await renderForm()

    await hover(form)
    await submit(form)

    expect(navigated.at(-1)!.replace).toBe(true)
  })

  test('goes straight to the results when the shell was never fetched', async () => {
    // Without a hover there is nothing in hand, and fetching a shell then the
    // results would be two requests to show one page.
    const form = await renderForm()

    await submit(form)

    expect(navigated.map((n) => n.url)).toEqual(['/search?q=laravel'])
  })

  test('goes straight there when the form adds nothing to the url', async () => {
    // The shell and the target are the same page; showing it twice is a render
    // for no reason.
    const container = document.createElement('div')
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <Form action="/search">
          <input name="q" defaultValue="" />
        </Form>,
      )
    })

    const form = container.querySelector('form')!
    await hover(form)
    await submit(form)

    expect(navigated.map((n) => n.url)).toEqual(['/search'])
  })
})
