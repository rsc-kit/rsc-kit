/**
 * What the client hooks answer during a server render.
 *
 * The bug this exists for shipped: usePathname returned a hardcoded "/" on the
 * server, so every prerendered page rendered its nav with the wrong link
 * marked active and only hydration put it right — a visible flash, and simply
 * wrong on a route that ships no client runtime to correct it.
 */

import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { PathnameProvider } from '../../src/js/PathnameProvider'
import { usePathname } from '../../src/js/usePathname'

function Nav() {
  const pathname = usePathname()

  return createElement(
    'a',
    { className: pathname === '/dashboard' ? 'active' : undefined },
    pathname,
  )
}

describe('usePathname on the server', () => {
  test('answers with the url being rendered', () => {
    const html = renderToString(
      createElement(PathnameProvider, { value: '/dashboard', children: createElement(Nav) }),
    )

    expect(html).toContain('/dashboard')
    expect(html).toContain('class="active"')
  })

  test('a different url gets a different answer', () => {
    // The whole point: one process renders many pages, so this cannot come
    // from a module-level variable.
    const html = renderToString(
      createElement(PathnameProvider, { value: '/orders', children: createElement(Nav) }),
    )

    expect(html).toContain('/orders')
    expect(html).not.toContain('class="active"')
  })

  test('falls back to / when nothing provided one', () => {
    // A route shipping no client runtime renders without the provider. It has
    // no hooks either, so this is only a floor, not a behaviour to rely on.
    expect(renderToString(createElement(Nav))).toContain('/')
  })
})
