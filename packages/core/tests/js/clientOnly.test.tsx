/**
 * What the server puts in the HTML, and what hydration expects to find.
 *
 * The pair has to agree exactly. `ClientOnly` exists because a value the
 * browser knows and the server does not — the clock, the viewport — is
 * otherwise produced twice and the two disagree, which React reports as a
 * hydration mismatch. On a page frozen at build time the gap is not
 * milliseconds but however long ago the build ran.
 */

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ClientOnly } from '../../src/js/ClientOnly'

describe('what the server renders', () => {
  test('is the fallback, never the children', () => {
    const html = renderToStaticMarkup(
      <ClientOnly fallback={<span>placeholder</span>}>
        <span>browser-only</span>
      </ClientOnly>,
    )

    expect(html).toContain('placeholder')
    expect(html).not.toContain('browser-only')
  })

  test('and nothing at all when no fallback is given', () => {
    const html = renderToStaticMarkup(
      <ClientOnly>
        <span>browser-only</span>
      </ClientOnly>,
    )

    // Whatever it is, it cannot be the children — that is the one thing the
    // server has no answer for.
    expect(html).not.toContain('browser-only')
  })
})
