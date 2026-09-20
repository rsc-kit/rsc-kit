// error.tsx — the nearest one to a failure renders instead of the segment.
//
// The boundary is a class component, because catching a render error is the one
// thing React still has no hook for, and a client one, because a server
// component can neither catch what happens in the browser nor be handed a
// reset callback.

import { registerDom } from './dom'

registerDom()

import { describe, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { RouteErrorBoundary, type RouteErrorProps } from '../../src/js/RouteErrorBoundary'

function Fallback({ error, reset }: RouteErrorProps) {
  return createElement(
    'div',
    null,
    createElement('span', { id: 'msg' }, error.message),
    createElement('button', { id: 'reset', onClick: reset }, 'Try again'),
  )
}

function mount(element: React.ReactElement) {
  const host = document.createElement('div')

  document.body.append(host)

  const root = createRoot(host)

  // React logs a caught error; silenced so a passing run is not a wall of red.
  const quiet = console.error

  console.error = () => {}
  act(() => root.render(element))
  console.error = quiet

  return {
    text: (id: string) => host.querySelector(`#${id}`)?.textContent ?? '',
    html: () => host.textContent ?? '',
    click: (id: string) => act(() => host.querySelector<HTMLButtonElement>(`#${id}`)?.click()),
    rerender: (next: React.ReactElement) => {
      console.error = () => {}
      act(() => root.render(next))
      console.error = quiet
    },
    unmount: () => act(() => root.unmount()),
  }
}

let shouldThrow = true

function Boom() {
  if (shouldThrow) throw new Error('the orders service is down')

  return createElement('span', { id: 'ok' }, 'recovered')
}

describe('a route error boundary', () => {
  test('renders the fallback with the error', () => {
    shouldThrow = true

    const view = mount(
      createElement(
        RouteErrorBoundary,
        { fallback: Fallback, resetKey: '/orders' },
        createElement(Boom),
      ),
    )

    expect(view.text('msg')).toBe('the orders service is down')

    view.unmount()
  })

  test('passes through when nothing throws', () => {
    shouldThrow = false

    const view = mount(
      createElement(
        RouteErrorBoundary,
        { fallback: Fallback, resetKey: '/orders' },
        createElement(Boom),
      ),
    )

    expect(view.text('ok')).toBe('recovered')

    view.unmount()
  })

  test('reset renders the segment again', () => {
    shouldThrow = true

    const view = mount(
      createElement(
        RouteErrorBoundary,
        { fallback: Fallback, resetKey: '/orders' },
        createElement(Boom),
      ),
    )

    expect(view.text('msg')).toBe('the orders service is down')

    // Whatever was wrong is fixed; reset is the button that says "try that
    // again" rather than "reload the page".
    shouldThrow = false
    view.click('reset')

    expect(view.text('ok')).toBe('recovered')

    view.unmount()
  })

  test('navigating away clears it', () => {
    shouldThrow = true

    const view = mount(
      createElement(
        RouteErrorBoundary,
        { fallback: Fallback, resetKey: '/orders' },
        createElement(Boom),
      ),
    )

    expect(view.text('msg')).toBe('the orders service is down')

    // Without this a caught boundary stays caught: the broken page's error
    // would sit over the new one, and only a reload would clear it.
    shouldThrow = false
    view.rerender(
      createElement(
        RouteErrorBoundary,
        { fallback: Fallback, resetKey: '/account' },
        createElement(Boom),
      ),
    )

    expect(view.text('ok')).toBe('recovered')

    view.unmount()
  })
})

// A redirect decided inside a page's Suspense boundary arrives as an error
// whose digest carries the destination. The route error boundary sits
// between that boundary and the RedirectBoundary, and it used to answer
// first: "Something went wrong … RSC_REDIRECT;307;/agent" on a page whose
// only fault was doing what it was told.
describe('a redirect thrown inside the segment', () => {
  test('is handed up to the RedirectBoundary, not shown as an error', async () => {
    const { RedirectBoundary } = await import('../../src/js/RedirectBoundary')
    const visited: unknown[] = []

    ;(window as any).__rsc_navigate = (url: string, opts: unknown) => {
      visited.push([url, opts])

      return Promise.resolve()
    }

    function Redirects(): React.ReactElement | null {
      const error = new Error('Redirect to /agent') as Error & { digest?: string }

      error.digest = 'RSC_REDIRECT;307;/agent'
      throw error
    }

    const view = mount(
      createElement(
        RedirectBoundary,
        null,
        createElement(
          RouteErrorBoundary,
          { fallback: Fallback, resetKey: '/shopify' },
          createElement(Redirects),
        ),
      ),
    )

    expect(view.text('msg')).toBe('')
    expect(view.html()).toBe('')
    expect(visited).toEqual([['/agent', { replace: true }]])

    delete (window as any).__rsc_navigate
    view.unmount()
  })

  test('a slot performs its own', async () => {
    const { SlotBoundary } = await import('../../src/js/SlotBoundary')
    const visited: string[] = []

    ;(window as any).__rsc_navigate = (url: string) => {
      visited.push(url)

      return Promise.resolve()
    }

    function Refuses(): React.ReactElement | null {
      const error = new Error('Redirect to /agent') as Error & { digest?: string }

      error.digest = 'RSC_REDIRECT;307;/agent'
      throw error
    }

    const view = mount(
      createElement(
        'main',
        null,
        createElement('h1', { id: 'kept' }, 'The layout stays'),
        createElement(SlotBoundary, { name: 'connection', children: createElement(Refuses) }),
      ),
    )

    expect(view.text('kept')).toBe('The layout stays')
    expect(visited).toEqual(['/agent'])

    delete (window as any).__rsc_navigate
    view.unmount()
  })
})
