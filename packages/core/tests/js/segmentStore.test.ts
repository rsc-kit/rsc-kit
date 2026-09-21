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
  isPrerendered,
  prerenderSegment,
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

describe('how stale a held page may be before a link stops revealing it', () => {
  afterEach(() => clearSegments())

  test('a link reveals one that is recent enough', () => {
    setSegment(1, '/a', 'A')
    setSegment(1, '/b', 'B')

    // Whatever a link passes as its window, a page stored a moment ago is
    // inside it — which is the case this exists for: leaving a form to check
    // something and coming straight back.
    expect(restoreSegments('/a', 30_000)).toBe(true)
    expect(getSegmentState(1)!.activeKey).toBe('/a')
  })

  test('and refetches one that is not, rather than showing yesterday as today', () => {
    setSegment(1, '/a', 'A')
    setSegment(1, '/b', 'B')

    // Zero means nothing qualifies, which is the boundary condition of the
    // window rather than a special case in the code.
    expect(restoreSegments('/a', 0)).toBe(false)
    expect(getSegmentState(1)!.activeKey).toBe('/b')
  })

  test('the back button is not bounded, because it names a moment', () => {
    setSegment(1, '/a', 'A')
    setSegment(1, '/b', 'B')

    // No window passed at all: going back means "the page I was on", and the
    // page from then is the right answer however long ago it was.
    expect(restoreSegments('/a')).toBe(true)
    expect(getSegmentState(1)!.activeKey).toBe('/a')
  })
})

describe('a page rendered before the click', () => {
  // A touch or a settled hover says which page is next; rendering it hidden
  // then makes the click a reveal. It is a guess, and a guess is held to
  // rules a visited page is not.

  test('is held hidden, and does not change what is showing', () => {
    setSegment(2, '/here', 'here')
    prerenderSegment(2, '/next', 'next')

    const state = getSegmentState(2)!

    expect(state.activeKey).toBe('/here')
    expect(state.entries.map((e) => e.key)).toEqual(['/here', '/next'])
    expect(isPrerendered(2, '/next')).toBe(true)
  })

  test('is not made before the boundary has anything, since it could not show it', () => {
    prerenderSegment(2, '/next', 'next')

    expect(getSegmentState(2)).toBeNull()
  })

  test('the navigation to it keeps the entry: same key, same tree, now active', () => {
    setSegment(2, '/here', 'here')
    prerenderSegment(2, '/next', 'next')
    setSegment(2, '/next', 'next')

    const state = getSegmentState(2)!

    expect(state.activeKey).toBe('/next')
    expect(state.entries.map((e) => e.key)).toEqual(['/here', '/next'])
    expect(isPrerendered(2, '/next')).toBe(false)
    // A visited page now: it can be returned to.
    setSegment(2, '/elsewhere', 'e')
    expect(restoreSegments('/next')).toBe(true)
  })

  test('a navigation to anything else drops it', () => {
    setSegment(2, '/here', 'here')
    prerenderSegment(2, '/next', 'next')
    setSegment(2, '/elsewhere', 'e')

    expect(isPrerendered(2, '/next')).toBe(false)
    expect(getSegmentState(2)!.entries.map((e) => e.key)).toEqual(['/here', '/elsewhere'])
  })

  test('one guess per depth; the next replaces it', () => {
    setSegment(2, '/here', 'here')
    prerenderSegment(2, '/first', 1)
    prerenderSegment(2, '/second', 2)

    expect(getSegmentState(2)!.entries.map((e) => e.key)).toEqual(['/here', '/second'])
  })

  test('never evicts a page the visitor was on', () => {
    for (let i = 0; i < RETENTION; i++) setSegment(2, `/p${i}`, i)
    prerenderSegment(2, '/guess', 'g')

    const state = getSegmentState(2)!

    expect(state.entries).toHaveLength(RETENTION + 1)
    expect(state.order).toHaveLength(RETENTION)
    for (let i = 0; i < RETENTION; i++) expect(restoreSegments(`/p${i}`)).toBe(true)
  })

  test('is not a held page: the back button and a link do not reveal it', () => {
    // Revealing it would show prefetched data as the page the visitor was
    // on. The navigation takes it through setSegment instead.
    setSegment(2, '/here', 'here')
    prerenderSegment(2, '/next', 'next')

    expect(restoreSegments('/next')).toBe(false)
    expect(getSegmentState(2)!.activeKey).toBe('/here')
  })

  test('a page already held needs no guess', () => {
    setSegment(2, '/a', 'a')
    setSegment(2, '/b', 'b')
    prerenderSegment(2, '/a', 'a-again')

    expect(isPrerendered(2, '/a')).toBe(false)
    expect(getSegmentState(2)!.entries.find((e) => e.key === '/a')!.tree).toBe('a')
  })

  test('tells the boundary, so it renders the hidden page', () => {
    setSegment(2, '/here', 'here')
    let told = 0
    const stop = subscribeToSegment(2, () => told++)

    prerenderSegment(2, '/next', 'next')

    expect(told).toBe(1)
    stop()
  })
})
