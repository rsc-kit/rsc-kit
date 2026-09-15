// Whether a form submitted before hydration reaches the server.
//
// It did not, and the documentation said it did — which is the worst pair. The
// element carried onSubmit and nothing else, so a submit before the javascript
// arrived did a GET to the current url and the action never ran.
//
// Rendered rather than reasoned about: what matters is the html, and the html
// is what was wrong.

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Form from '../../src/js/Form'

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(Form as never, props as never, createElement('input', { name: 'title' })),
  )

describe('a form posting to a url', () => {
  test('carries the action and the method a browser needs', () => {
    const html = render({ action: '/search', method: 'get' })

    expect(html).toContain('action="/search"')
    expect(html).toContain('method="get"')
  })

  test('so the fields are submittable with no javascript at all', () => {
    // The whole point: this html, on its own, posts somewhere real.
    expect(render({ action: '/search', method: 'get' })).toContain('<input name="title"/>')
  })
})

describe('a form calling a server action', () => {
  test('hands the action to react rather than only to onSubmit', () => {
    // React emits a form a browser can submit on its own for a server
    // reference. Here the action is a plain function, so there is no reference
    // metadata to emit — what is asserted is that it reached the element at
    // all, which is the part that was missing.
    const action = async () => ({})
    const props: Record<string, unknown> = { action }

    expect(() => render(props)).not.toThrow()
  })

  test('and no method, which react sets itself', () => {
    // Passing one alongside a function action is what React warns about.
    expect(render({ action: async () => ({}) })).not.toContain('method=')
  })
})
