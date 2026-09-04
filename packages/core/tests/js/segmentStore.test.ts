/**
 * What each boundary is showing, and what it keeps alive behind it.
 *
 * Its default matters as much as its behaviour: with nothing stored, a
 * boundary renders the children the server sent — the behaviour that existed
 * before boundaries did.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import {
  RETENTION,
  clearSegments,
  getSegmentState,
  restoreSegments,
  seedSegment,
  setSegment,
  subscribeToSegment,
} from '../../src/js/segmentStore'

afterEach(() => clearSegments())

describe('defaults', () => {
  test('an untouched depth has no state, meaning "render the server tree"', () => {
    expect(getSegmentState(1)).toBeNull()
  })
})

describe('replacing a segment', () => {
  test('shows the new page and keeps the old one mounted', () => {
    setSegment(2, '/a', 'tree-a')
    setSegment(2, '/b', 'tree-b')

    const state = getSegmentState(2)!

    expect(state.activeKey).toBe('/b')
    // /a is still there — hidden, not unmounted, so its state survives.
    expect(state.entries.map((e) => e.key)).toEqual(['/a', '/b'])
  })

  test('discards deeper segments, which belonged to the replaced page', () => {
    setSegment(1, '/docs', 'section')
    setSegment(2, '/docs/a', 'page')

    setSegment(1, '/blog', 'other-section')

    expect(getSegmentState(2)).toBeNull()
  })

  test('notifies the deeper boundary it was discarded', () => {
    setSegment(2, '/docs/a', 'page')
    let notified = 0
    subscribeToSegment(2, () => notified++)

    setSegment(1, '/blog', 'other')

    expect(notified).toBe(1)
  })
})

describe('returning to a page', () => {
  test('reveals it without a new tree', () => {
    setSegment(2, '/a', 'tree-a')
    setSegment(2, '/b', 'tree-b')

    expect(restoreSegments('/a')).toBe(true)
    expect(getSegmentState(2)!.activeKey).toBe('/a')
  })

  test('refuses a page no boundary is holding, so the router fetches', () => {
    setSegment(2, '/a', 'tree-a')

    expect(restoreSegments('/never-seen')).toBe(false)
  })

  test('a shallower boundary holding another key does not block it', () => {
    // Depth 1 holds the section, depth 2 the page within it. Depth 1's tree
    // contains the depth-2 boundary, so it shows whatever that one shows —
    // it does not need a key of its own.
    setSegment(1, '/docs', 'section')
    setSegment(2, '/docs/a', 'page-a')
    setSegment(2, '/docs/b', 'page-b')

    expect(restoreSegments('/docs/a')).toBe(true)
    expect(getSegmentState(2)!.activeKey).toBe('/docs/a')
    // Untouched: the section around both pages is the same.
    expect(getSegmentState(1)!.activeKey).toBe('/docs')
  })

  test('refuses when nothing has been stored at all', () => {
    expect(restoreSegments('/a')).toBe(false)
  })
})

describe('the page you arrived on', () => {
  test('is retained, so you can come back to it', () => {
    // Seeded from the server-rendered children; without this the first page is
    // the one page that cannot be returned to.
    seedSegment(2, '/a', 'server-children')
    setSegment(2, '/b', 'tree-b')

    expect(restoreSegments('/a')).toBe(true)
  })

  test('does not change what is showing', () => {
    setSegment(2, '/b', 'tree-b')
    seedSegment(2, '/a', 'server-children')

    expect(getSegmentState(2)!.activeKey).toBe('/b')
  })

  test('is ignored once that page is already held', () => {
    setSegment(2, '/a', 'navigated')
    seedSegment(2, '/a', 'stale-children')

    expect(getSegmentState(2)!.entries).toHaveLength(1)
    expect(getSegmentState(2)!.entries[0].tree).toBe('navigated')
  })
})

describe('retention', () => {
  test('drops the least recently shown past the limit', () => {
    setSegment(2, '/first', 'a')

    for (let i = 0; i < RETENTION; i++) setSegment(2, `/p${i}`, i)

    // Hidden trees keep their DOM, so the window has to be bounded.
    expect(restoreSegments('/first')).toBe(false)
    expect(getSegmentState(2)!.entries).toHaveLength(RETENTION)
  })

  test('revisiting a page keeps it alive', () => {
    setSegment(2, '/keep', 'a')

    for (let i = 0; i < RETENTION + 2; i++) {
      setSegment(2, '/other', i)
      expect(restoreSegments('/keep')).toBe(true)
    }
  })
})

describe('clearing', () => {
  test('returns every boundary to its server-given children', () => {
    setSegment(1, '/a', 'x')
    setSegment(2, '/a/b', 'y')

    clearSegments()

    expect(getSegmentState(1)).toBeNull()
    expect(getSegmentState(2)).toBeNull()
  })
})
