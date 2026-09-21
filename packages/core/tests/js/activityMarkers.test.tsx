/**
 * Whether a document can be hydrated by a tree of segment boundaries.
 *
 * Every boundary is an <Activity>, and React 19.2 does not recover from a
 * hydration mismatch at one: the boundary retries hydrating, mismatches
 * again, and the main thread never returns. A parameterised route's PPR
 * shell from a build before 0.20.8 has no Activity markers at all, so the
 * client counts them before React starts and renders instead of hydrating
 * when there are none where the page has layouts.
 */

import { registerDom } from './dom'

registerDom()

import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { SegmentBoundary } from '../../src/js/SegmentBoundary'
import { activityMarkersIn } from '../../src/js/activityMarkers'

function documentOf(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

describe('counting the Activity boundaries in a document', () => {
  test('one per segment boundary the server rendered', () => {
    const html = renderToString(
      <SegmentBoundary depth={1}>
        <SegmentBoundary depth={2}>
          <p>page</p>
        </SegmentBoundary>
      </SegmentBoundary>,
    )

    expect(activityMarkersIn(documentOf(html))).toBe(2)
  })

  test('none in the shell an earlier build wrote for a parameterised route', () => {
    // What rsc-static/agent/tools/_id_.ppr.html held: Suspense holes, no Activities.
    const html = '<div><!--$?--><template id="B:0"></template><p>loading</p><!--/$--></div>'

    expect(activityMarkersIn(documentOf(html))).toBe(0)
  })

  test('the closing marker is not counted', () => {
    expect(activityMarkersIn(documentOf('<!--&--><p>x</p><!--/&-->'))).toBe(1)
  })
})
