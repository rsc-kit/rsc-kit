// Why a route ships a shell rather than a whole page.
//
// The classification was always there; what was missing is the reason. "◐
// /orders" on its own leaves whoever reads the build output to go and find
// which call did it, and that is the afternoon this line saves.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cookies, headers, requestReadBy, searchParams, url, withRequest } from '../../src/request'
import { clientJsSize, notes } from '../../src/prerender'

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

describe('how much javascript a route costs', () => {
  test('says so plainly when a route ships none', () => {
    // A page with nothing interactive on it. Worth naming rather than printing
    // 0 kB, because that is the thing the no-javascript guide is about.
    expect(clientJsSize(0)).toBe('no js')
  })

  test('rounds once the number is big enough that a decimal is noise', () => {
    expect(clientJsSize(85_461)).toBe('85 kB')
    expect(clientJsSize(97_755)).toBe('98 kB')
  })

  test('keeps a decimal while it still means something', () => {
    expect(clientJsSize(6_243)).toBe('6.2 kB')
  })
})

describe('the report the build leaves behind', () => {
  test('counts the same things the summary line counts', async () => {
    // The report and the terminal must not be able to disagree about what
    // happened — they are written from the same rows, and this holds that.
    const { buildReport } = await import('../../src/buildReport')
    const routes = [
      { url: '/', component: 'app/page', type: 'frozen', reason: null, warning: null, clientJs: 1 },
      { url: '/a', component: 'app/a/page', type: 'shell', reason: 'x', warning: null, clientJs: 2 },
    ]
    const apis = [{ url: '/api/h', name: 'app/api/h/route', type: 'frozen', reason: null }]
    const report = JSON.parse(buildReport(routes, apis))

    expect(report.totals).toEqual({ static: 2, partial: 1, dynamic: 0, failed: 0 })
    expect(report.version).toBe(1)
  })

  test('a blocked route is a failure, not a dynamic one', async () => {
    // Blocked means nothing painted before the page read the request, and the
    // build refuses it. Counting it as dynamic told an agent the build was
    // fine with one more per-request page.
    const { buildReport } = await import('../../src/buildReport')
    const report = JSON.parse(
      buildReport(
        [{ url: '/orders', component: 'app/orders/page', type: 'blocked', reason: 'reads the request before anything can paint.', warning: null, clientJs: null }],
        [],
      ),
    )

    expect(report.totals).toEqual({ static: 0, partial: 0, dynamic: 0, failed: 1 })
  })

  test('orders by what someone looking for a problem reads first', async () => {
    const { byInterest } = await import('../../src/buildReport')
    const of = (url: string, type: string) => ({
      url,
      component: url,
      type,
      reason: null,
      warning: null,
      clientJs: null,
    })

    expect(
      byInterest([of('/d', 'frozen'), of('/c', 'shell'), of('/b', 'blocked'), of('/a', 'error')]).map(
        (r) => r.url,
      ),
    ).toEqual(['/a', '/b', '/c', '/d'])
  })
})
