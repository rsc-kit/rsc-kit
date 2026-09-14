// Why a route ships a shell rather than a whole page.
//
// The classification was always there; what was missing is the reason. "◐
// /orders" on its own leaves whoever reads the build output to go and find
// which call did it, and that is the afternoon this line saves.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cookies, headers, requestReadBy, searchParams, url, withRequest } from '../../src/request'
import { notes } from '../../src/prerender'

/** A render with no request, which is what a build is. */
const duringABuild = <T>(fn: () => Promise<T>) => withRequest(null as never, fn)

describe('what reached for the request', () => {
  test('nothing, when a page reads nothing', async () => {
    await duringABuild(async () => {
      expect(requestReadBy()).toEqual([])
    })
  })

  test('names the accessor a page called', async () => {
    await duringABuild(async () => {
      // Never settles during a build — that is how the page becomes a shell —
      // so it is started rather than awaited.
      void headers()

      expect(requestReadBy()).toEqual(['headers()'])
    })
  })

  test('says cookies() for cookies(), not the headers() it is built on', async () => {
    await duringABuild(async () => {
      void cookies()

      // Recorded before the await inside it. Otherwise the build reports a call
      // nobody wrote, and the file it names has no headers() in it.
      expect(requestReadBy()[0]).toBe('cookies()')
    })
  })

  test('and searchParams() for searchParams()', async () => {
    await duringABuild(async () => {
      void searchParams()

      expect(requestReadBy()[0]).toBe('searchParams()')
    })
  })

  test('lists several without repeating one', async () => {
    await duringABuild(async () => {
      void headers()
      void headers()
      void url()

      expect(requestReadBy()).toEqual(['headers()', 'url()'])
    })
  })
})

describe('the note under the summary', () => {
  test('is silent when nothing reached for the backend', () => {
    expect(notes([{ reason: 'data took longer than the build budget' }])).toBe('')
    expect(notes([{ reason: null }, {}])).toBe('')
  })

  test('explains why the build did not simply make the call', () => {
    const text = notes([{ reason: 'dynamic — called rpc("getUser")' }])

    // The mark and the reason say what happened. This is the question they
    // leave: the backend is running, so why did the build not use it.
    expect(text).toContain('A build has no backend to call')
    expect(text).toContain('await connection()')
  })

  test('is printed once however many routes did it', () => {
    const text = notes([
      { reason: 'dynamic — called rpc("getUser")' },
      { reason: 'dynamic — called rpc("getOrders")' },
      { reason: 'dynamic — called rpc("getCart")' },
    ])

    expect(text.split('A build has no backend')).toHaveLength(2)
  })
})
