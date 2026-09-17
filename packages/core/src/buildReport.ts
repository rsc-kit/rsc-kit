// What the build decided, written down.
//
// The classification exists already — it is printed as the build runs, and
// then it is gone. That is fine for a person watching a terminal and useless
// for anything that wants to ask afterwards: a CI step asserting nothing
// regressed, an editor, an agent being asked why a page is slow.
//
// So the same facts go to a file. Not a new computation and not a second
// source of truth — the report is written from the results the build already
// produced, in the same pass that prints them.

/** One route, as the build left it. */
export interface ReportedRoute {
  url: string
  component: string
  /** frozen | shell | blocked | dynamic | error — see PrerenderResult. blocked and error failed the build. */
  type: string
  /** Why it is not frozen, in the words the build printed. */
  reason: string | null
  /** Something true and worth knowing that is not a failure. */
  warning: string | null
  /** Gzipped bytes of javascript this url makes the browser download. */
  clientJs: number | null
}

export interface ReportedApiRoute {
  url: string
  name: string
  type: string
  reason: string | null
}

export interface BuildReport {
  version: 1
  /** Routes that render, in the order the build reported them. */
  routes: ReportedRoute[]
  /** route.ts endpoints. */
  apis: ReportedApiRoute[]
  totals: {
    static: number
    partial: number
    dynamic: number
    failed: number
  }
}

/** The name the report is written under, inside the build's own directory. */
export const REPORT_FILE = 'build-report.json'

export function buildReport(
  routes: ReportedRoute[],
  apis: ReportedApiRoute[],
): string {
  const count = (...types: string[]) =>
    routes.filter((r) => types.includes(r.type)).length +
    apis.filter((a) => types.includes(a.type)).length

  const report: BuildReport = {
    version: 1,
    routes,
    apis,
    totals: {
      static: count('frozen'),
      partial: count('shell'),
      dynamic: count('dynamic'),
      // Blocked is refused, not dynamic: a page that painted nothing before it
      // read the request has no shell to store and the build did not finish.
      failed: count('error', 'blocked'),
    },
  }

  return JSON.stringify(report, null, 2) + '\n'
}

/**
 * The routes worth asking about, most interesting first.
 *
 * "Interesting" is not a judgement about the app — it is the order someone
 * looking for a problem reads in. A failure first, then a page that could not
 * be stored at all, then one that ships a shell, then the ones that are fine.
 */
export function byInterest(routes: ReportedRoute[]): ReportedRoute[] {
  const rank: Record<string, number> = { error: 0, blocked: 1, shell: 2, dynamic: 3, frozen: 4 }

  return [...routes].sort(
    (a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9) || a.url.localeCompare(b.url),
  )
}
