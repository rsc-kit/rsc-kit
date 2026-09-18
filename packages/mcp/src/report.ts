// Reading what the build wrote down.
//
// Everything this server answers comes from one file: `build-report.json`, in
// the build's own output directory. Nothing here runs a build, imports the
// app, or re-derives the route tree — the build already decided all of this,
// and a second implementation would be a second thing that can be wrong.
//
// The consequence to be honest about: an answer is only as fresh as the last
// build. So every answer says when it was built, and a missing report says
// "run a build" rather than "there are no routes".

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ReportedRoute {
  url: string;
  component: string;
  type: string;
  reason: string | null;
  warning: string | null;
  /** How it was stored, when that is worth knowing - "no client components, so ships no javascript". */
  note?: string | null;
  clientJs: number | null;
}

export interface ReportedApiRoute {
  url: string;
  name: string;
  type: string;
  reason: string | null;
  /** Stored, and froze a value that will not be the same tomorrow. Absent from older reports. */
  warning?: string | null;
}

export interface ReportedAction {
  id: string;
  name: string;
  file: string;
  /** Built by createActionClient, so its middleware ran. */
  client: boolean;
  /** A read (GET) rather than a mutation. */
  query: boolean;
}

export interface BuildReport {
  version: number;
  routes: ReportedRoute[];
  apis: ReportedApiRoute[];
  /** Absent from reports written before actions were audited. */
  actions?: ReportedAction[];
  /**
   * Server files importing `cache` from React, relative to the source dir.
   * React's memoises only inside a component render; in a guard, an action
   * or an api route it calls straight through. Absent from older reports.
   */
  reactCache?: string[];
  /** Server files importing a client library: the packages, and who imports the file. Absent from older reports. */
  clientImports?: { file: string; packages: string[]; from: string | null }[];
  totals: { static: number; partial: number; dynamic: number; failed: number };
}

/** Where a build leaves its report, in the order worth looking. */
const LIKELY = [".rsc", "build", "dist", ".output"];

export class NoReport extends Error {
  constructor(root: string) {
    super(
      `No build report under ${root}. This server answers from what the last build ` +
        "decided, so there has to have been one — run the build and ask again.",
    );
    this.name = "NoReport";
  }
}

/** The report, and how old it is. */
export function loadReport(root: string): {
  report: BuildReport;
  builtAt: Date;
  from: string;
} {
  const base = resolve(root);

  for (const dir of LIKELY) {
    const file = join(base, dir, "build-report.json");

    if (!existsSync(file)) continue;

    return {
      report: JSON.parse(readFileSync(file, "utf-8")) as BuildReport,
      // The file's own mtime rather than a timestamp inside it: a stamp written
      // into the file changes the file on every build even when nothing else
      // did, which defeats every cache keyed on its contents.
      builtAt: statSync(file).mtime,
      from: file,
    };
  }

  throw new NoReport(base);
}

/** What each classification means, in one line, for an answer that has to stand alone. */
export const MEANING: Record<string, string> = {
  frozen: "stored whole at build time and served as a file",
  shell: "a stored shell, with the rest rendered per request",
  blocked:
    "REFUSED — nothing could paint before it read the request, so the build did not finish",
  dynamic: "answered per request",
  error: "failed to render",
};

/** A route by url, tolerating a trailing slash either way. */
export function routeFor(
  report: BuildReport,
  url: string,
): ReportedRoute | ReportedApiRoute | null {
  const wanted = (url.split("?")[0].replace(/\/+$/, "") || "/").toLowerCase();
  const matches = (candidate: string) =>
    (candidate.replace(/\/+$/, "") || "/").toLowerCase() === wanted;

  return (
    report.routes.find((r) => matches(r.url)) ??
    report.apis.find((a) => matches(a.url)) ??
    null
  );
}
