// What the introspection tools say.
//
// These are read by an agent as prose and acted on, so a vague sentence becomes
// a wrong edit somewhere else. The assertions are mostly about the sentences
// that stop a wrong edit: what a state means, and that an answer is only as
// fresh as the last build.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asOf, explainRoute, heaviestRoutes, listRoutes, whatIsDynamic } from '../src/answers'
import { NoReport, loadReport, routeFor } from '../src/report'
import type { BuildReport } from '../src/report'

const NOW = 1_800_000_000_000

const report: BuildReport = {
  version: 1,
  routes: [
    { url: '/', component: 'app/page', type: 'frozen', reason: null, warning: null, clientJs: 86_000 },
    {
      url: '/locale',
      component: 'app/locale/page',
      type: 'shell',
      reason: 'dynamic — called cookies(), headers()',
      warning: null,
      clientJs: 85_273,
    },
  ],
  apis: [
    { url: '/api/health', name: 'app/api/health/route', type: 'frozen', reason: null },
    {
      url: '/guarded/api/secret',
      name: 'app/guarded/api/secret/route',
      type: 'dynamic',
      reason: 'guarded by middleware',
    },
  ],
  totals: { static: 2, partial: 1, dynamic: 1, failed: 0 },
}

const builtAt = new Date(NOW - 5 * 60_000)

describe('every answer says how old it is', () => {
  test('because the one way this misleads is by being confidently stale', () => {
    expect(asOf(builtAt, NOW)).toBe('(from the last build, 5 minutes ago)')
    expect(asOf(new Date(NOW - 90 * 60_000), NOW)).toContain('hours ago')
    expect(asOf(new Date(NOW - 1_000), NOW)).toContain('just now')
  })

  test('and every tool carries it', () => {
    for (const answer of [
      listRoutes(report, builtAt, NOW),
      explainRoute(report, '/locale', builtAt, NOW),
      whatIsDynamic(report, builtAt, NOW),
      heaviestRoutes(report, builtAt, NOW),
    ]) {
      expect(answer).toContain('from the last build')
    }
  })
})

describe('explaining one route', () => {
  test('names the reason the build recorded, not a guess', () => {
    const answer = explainRoute(report, '/locale', builtAt, NOW)

    expect(answer).toContain('called cookies(), headers()')
    expect(answer).toContain('app/locale/page')
    expect(answer).toContain('85 kB')
  })

  test('a stored page says there is nothing to fix', () => {
    // Otherwise an agent asked to "make this faster" edits a page that is
    // already a file on disk.
    expect(explainRoute(report, '/', builtAt, NOW)).toContain('Nothing to fix')
  })

  test('an unknown url hands back the ones that exist', () => {
    const answer = explainRoute(report, '/nope', builtAt, NOW)

    expect(answer).toContain('No route for /nope')
    expect(answer).toContain('/locale')
    expect(answer).toContain('/api/health')
  })

  test('a trailing slash or a query string still finds it', () => {
    expect(routeFor(report, '/locale/')?.url).toBe('/locale')
    expect(routeFor(report, '/locale?x=1')?.url).toBe('/locale')
  })

  test('api routes are explained too, without pretending they have a component', () => {
    const answer = explainRoute(report, '/guarded/api/secret', builtAt, NOW)

    expect(answer).toContain('guarded by middleware')
    expect(answer).not.toContain('Rendered by')
  })
})

describe('a build that failed', () => {
  test('is the first line, before any route', () => {
    const failed = {
      ...report,
      routes: [
        ...report.routes,
        { url: '/orders', component: 'app/orders/page', type: 'blocked', reason: 'reads the request before anything can paint. Add a loading.tsx beside it, or put a <Suspense> above the waiting, and it has a skeleton to store.', warning: null, clientJs: null },
      ],
      totals: { ...report.totals, failed: 1 },
    }
    const answer = listRoutes(failed, builtAt, NOW)

    expect(answer.startsWith('THE LAST BUILD FAILED: 1 route refused')).toBe(true)
    expect(answer).toContain('/orders  — REFUSED')
    expect(answer).toContain('put a <Suspense> above the waiting')
  })

  test('is not mentioned when it did not', () => {
    expect(listRoutes(report, builtAt, NOW)).not.toContain('FAILED')
  })
})

describe('the actions', () => {
  test('name the ones nothing checks, and where they are', () => {
    const answer = listRoutes(
      {
        ...report,
        actions: [
          { id: 'a#createPost', name: 'createPost', file: 'src/actions.ts', client: true, query: false },
          { id: 'a#deletePost', name: 'deletePost', file: 'src/actions.ts', client: false, query: false },
          { id: 'q#getFeed', name: 'getFeed', file: 'src/queries.ts', client: false, query: true },
        ],
      },
      builtAt,
      NOW,
    )

    expect(answer).toContain('actions: 3, 1 built from an action client')
    expect(answer).toContain('2 run NO middleware')
    expect(answer).toContain('deletePost in src/actions.ts')
    expect(answer).toContain('getFeed (query) in src/queries.ts')
    expect(answer).not.toContain('createPost in')
  })

  test('say when the build was too old to have looked', () => {
    expect(listRoutes(report, builtAt, NOW)).toContain('not audited by this build')
  })
})

describe('what renders per request', () => {
  test('lists only those, with reasons', () => {
    const answer = whatIsDynamic(report, builtAt, NOW)

    expect(answer).toContain('/locale')
    expect(answer).toContain('/guarded/api/secret')
    expect(answer).not.toContain('/api/health')
  })

  test('and says dynamic is usually correct', () => {
    // Without this an agent treats the list as a defect list and "fixes" pages
    // whose content genuinely depends on the request.
    expect(whatIsDynamic(report, builtAt, NOW)).toContain('usually correct')
  })

  test('an entirely static app says so plainly', () => {
    const allStatic = { ...report, routes: [report.routes[0]], apis: [report.apis[0]] }

    expect(whatIsDynamic(allStatic, builtAt, NOW)).toContain('Every route is stored')
  })
})

describe('when there is no build to read', () => {
  test('it says to run one rather than reporting no routes', () => {
    // "0 routes" would be a lie an agent acts on.
    const empty = mkdtempSync(join(tmpdir(), 'no-build-'))

    expect(() => loadReport(empty)).toThrow(NoReport)

    try {
      loadReport(empty)
    } catch (error) {
      expect((error as Error).message).toContain('run the build')
    }
  })

  test('and a report is found wherever the build put it', () => {
    const root = mkdtempSync(join(tmpdir(), 'built-'))

    mkdirSync(join(root, 'build'))
    writeFileSync(join(root, 'build/build-report.json'), JSON.stringify(report))

    expect(loadReport(root).report.routes).toHaveLength(2)
  })
})
