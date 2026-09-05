/**
 * The query string, in a client component.
 *
 * Unlike usePathname there is no honest server answer: the same route is asked
 * for with ?q=shoes and with ?q=hats, and a page stored holding one of them
 * would serve it to everyone. So the server snapshot throws, and what happens
 * next is the point of these tests.
 */

import { registerDom } from './dom'

registerDom()

const { describe, expect, test } = await import('bun:test')
const { Suspense, act, createElement } = await import('react')
const { renderToString } = await import('react-dom/server')
const { createRoot } = await import('react-dom/client')
const { useSearchParams } = await import('../../src/js/useSearchParams')

function Query() {
  return createElement('p', null, useSearchParams().get('q') ?? '(none)')
}

describe('rendering on the server', () => {
  test('throws, rather than pretending the query was empty', () => {
    // Answering with an empty URLSearchParams would store a page showing
    // results for no query at all, with nothing to say so.
    expect(() => renderToString(createElement(Query))).toThrow(/no query string/)
  })

  test('the message says what to do about it', () => {
    expect(() => renderToString(createElement(Query))).toThrow(/<Suspense>|loading\.tsx/)
  })

  test('inside a boundary, the fallback is what renders', () => {
    // React treats the throw as recoverable at the nearest boundary: the
    // fallback is stored and the browser renders the real thing on hydration.
    const html = renderToString(
      createElement(Suspense, {
        fallback: createElement('p', null, 'reading…'),
        children: createElement(Query),
      }),
    )

    expect(html).toContain('reading…')
    expect(html).not.toContain('(none)')
  })
})

describe('in the browser', () => {
  test('reads the query that is there', () => {
    window.history.replaceState({}, '', '/search?q=shoes')

    expect(render()).toBe('shoes')
  })

  test('a stable snapshot, or React would loop', () => {
    // useSyncExternalStore compares snapshots by identity. A fresh
    // URLSearchParams per read reads as "changed every render", and React 19
    // throws rather than spinning — so a render that completes is the test.
    window.history.replaceState({}, '', '/search?q=hats')

    expect(() => render()).not.toThrow()
    expect(render()).toBe('hats')
  })

  test('follows a navigation', () => {
    window.history.replaceState({}, '', '/search?q=one')

    const { container, root } = mount()

    expect(container.textContent).toBe('one')

    act(() => {
      window.history.replaceState({}, '', '/search?q=two')
      window.dispatchEvent(new Event('rsc-navigate'))
    })

    expect(container.textContent).toBe('two')

    act(() => root.unmount())
  })
})

function mount() {
  const container = document.createElement('div')

  document.body.appendChild(container)

  const root = createRoot(container)

  act(() => root.render(createElement(Query)))

  return { container, root }
}

function render(): string {
  const { container, root } = mount()
  const text = container.textContent ?? ''

  act(() => root.unmount())

  return text
}
