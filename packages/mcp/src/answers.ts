// The answers, as text, with no protocol in them.
//
// Separated from the server so they can be tested by calling them, and so the
// wording is reviewable in one place. An agent reads these as prose and acts on
// them, so a vague sentence here becomes a wrong edit somewhere else — "this
// route is dynamic" invites a fix, "this route reads cookies, which is why"
// invites the right one.

import type { BuildReport, ReportedApiRoute, ReportedRoute } from "./report.js";
import { MEANING, routeFor } from "./report.js";

const kb = (bytes: number) =>
  `${bytes < 10_000 ? (bytes / 1000).toFixed(1) : Math.round(bytes / 1000)} kB`;

const age = (builtAt: Date, now: number): string => {
  const minutes = Math.round((now - builtAt.getTime()) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);

  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  return `${Math.round(hours / 24)} days ago`;
};

/**
 * Every answer says how old it is.
 *
 * The one way this server misleads is by being confidently stale: it reports
 * the last build, and the file on disk may have changed since. Saying so on
 * every answer is cheaper than being wrong once.
 */
export function asOf(builtAt: Date, now: number): string {
  return `(from the last build, ${age(builtAt, now)})`;
}

export function listRoutes(
  report: BuildReport,
  builtAt: Date,
  now: number,
): string {
  const lines = [
    `${report.routes.length} routes and ${report.apis.length} api routes ${asOf(builtAt, now)}`,
    "",
  ];

  // First, before the table, because it changes what the table means: these
  // rows are from a build that did not finish, and nothing below is deployed.
  if (report.totals.failed > 0) {
    lines.unshift(
      `THE LAST BUILD FAILED: ${report.totals.failed} route${report.totals.failed === 1 ? "" : "s"} refused. Each one's line below says what to change. Fix it and build again.`,
      "",
    );
  }

  for (const route of report.routes) {
    const size = route.clientJs === null ? "" : `  ${kb(route.clientJs)}`;

    lines.push(`${route.url}${size}  — ${MEANING[route.type] ?? route.type}`);

    if (route.reason) lines.push(`    ${route.reason}`);
    if (route.note) lines.push(`    ${route.note}`);
  }

  if (report.apis.length) {
    lines.push("", "api routes:");

    for (const api of report.apis) {
      lines.push(`${api.url}  — ${MEANING[api.type] ?? api.type}`);

      if (api.reason) lines.push(`    ${api.reason}`);
    }
  }

  lines.push(
    "",
    `${report.totals.static} static, ${report.totals.partial} partial prerender, ${report.totals.dynamic} dynamic` +
      (report.totals.failed ? `, ${report.totals.failed} failed` : ""),
  );

  lines.push("", ...actionLines(report));
  lines.push(...reactCacheLines(report));
  lines.push(...clientImportLines(report));

  return lines.join("\n");
}

function isPage(
  route: ReportedRoute | ReportedApiRoute,
): route is ReportedRoute {
  return "component" in route;
}

export function explainRoute(
  report: BuildReport,
  url: string,
  builtAt: Date,
  now: number,
): string {
  const route = routeFor(report, url);

  if (!route) {
    // The urls, not just "not found": the caller has a url that does not exist,
    // and the most useful next thing is the ones that do.
    return (
      `No route for ${url} ${asOf(builtAt, now)}.\n\n` +
      "Known urls:\n" +
      [...report.routes, ...report.apis].map((r) => `  ${r.url}`).join("\n")
    );
  }

  const lines = [
    `${route.url} — ${MEANING[route.type] ?? route.type} ${asOf(builtAt, now)}`,
  ];

  if (isPage(route)) {
    lines.push(`Rendered by ${route.component}.`);

    if (route.clientJs !== null) {
      lines.push(`Ships ${kb(route.clientJs)} of javascript, gzipped.`);
    }
  }

  if (route.reason)
    lines.push("", `Why it is not stored whole: ${route.reason}`);

  if (isPage(route) && route.warning)
    lines.push("", `Warning: ${route.warning}`);

  if (route.type === "frozen") {
    lines.push(
      "",
      "Nothing to fix. It is rendered once at build time and served as a file.",
    );
  }

  return lines.join("\n");
}

/**
 * The routes that are not stored, and why.
 *
 * The question behind most of the others — someone asking "why is my site
 * slow" wants this list, not the whole table. Routes that are fine are left
 * out entirely rather than listed and dismissed.
 */
export function whatIsDynamic(
  report: BuildReport,
  builtAt: Date,
  now: number,
): string {
  const pages = report.routes.filter((r) => r.type !== "frozen");
  const apis = report.apis.filter((a) => a.type !== "frozen");

  if (pages.length === 0 && apis.length === 0) {
    return `Every route is stored at build time ${asOf(builtAt, now)}. Nothing renders per request.`;
  }

  const lines = [
    `${pages.length + apis.length} of ${report.routes.length + report.apis.length} routes render per request ${asOf(builtAt, now)}:`,
    "",
  ];

  for (const route of [...pages, ...apis]) {
    lines.push(
      `${route.url} — ${route.reason ?? MEANING[route.type] ?? route.type}`,
    );
  }

  lines.push(
    "",
    "Reading the request is what makes a route dynamic: cookies(), headers(), searchParams(),",
    "or connection() said deliberately. That is usually correct — a page whose content depends",
    "on who is asking cannot be one stored file. Change it only if the read was accidental.",
  );

  return lines.join("\n");
}

/** The heaviest routes, for the question that follows the size column. */
export function heaviestRoutes(
  report: BuildReport,
  builtAt: Date,
  now: number,
  top = 10,
): string {
  const weighed = report.routes
    .filter((r) => r.clientJs !== null)
    .sort((a, b) => (b.clientJs ?? 0) - (a.clientJs ?? 0));

  if (weighed.length === 0) {
    return `No route shipped measurable javascript ${asOf(builtAt, now)}.`;
  }

  const lightest = weighed[weighed.length - 1].clientJs ?? 0;

  return [
    `Heaviest routes ${asOf(builtAt, now)}:`,
    "",
    ...weighed.slice(0, top).map((r) => `${kb(r.clientJs ?? 0)}  ${r.url}`),
    "",
    `The lightest route ships ${kb(lightest)}, so the difference between them is`,
    `${kb((weighed[0].clientJs ?? 0) - lightest)} of client components — most of the rest is React itself,`,
    "which every route pays for.",
  ].join("\n");
}

/**
 * The actions, and the one fact about each that nothing else states: whether
 * anything checks who calls it. A bare "use server" export runs with no
 * middleware; an agent adding a delete button needs to know that before it
 * trusts the id it was handed.
 */
/**
 * Server files still importing cache from React. React's dedupes only inside
 * a component render; in a guard, an action or an api route it calls straight
 * through, silently - the helper runs twice and nothing says so but this.
 */
export function reactCacheLines(report: BuildReport): string[] {
  const files = report.reactCache;

  if (!files || files.length === 0) return [];

  return [
    "",
    `${files.length} server ${files.length === 1 ? "file imports" : "files import"} cache from 'react': ${files.join(", ")}`,
    "React's cache() dedupes only inside a component render; in a guard, an action or an api route it calls straight through. Import cache from @rsc-kit/core/cache, which spans the request.",
  ];
}

/**
 * Server files importing a client library. Legal for a server component; a
 * file with no "use client" that only wraps client components (a shadcn ui/
 * file that lost its directive) wants the directive back, so the library's
 * internals stop running on the server.
 */
export function clientImportLines(report: BuildReport): string[] {
  const found = report.clientImports;

  if (!found || found.length === 0) return [];

  return [
    "",
    `${found.length} server ${found.length === 1 ? "file imports" : "files import"} a client library: ` +
      found
        .map(
          (c) =>
            `${c.file} (${c.packages.join(", ")}${c.from ? `; imported by ${c.from}` : ""})`,
        )
        .join("; "),
    'Legal for a server component. A file that only wraps client components wants "use client" - as shadcn ships it - so the server stops at the boundary.',
  ];
}

export function actionLines(report: BuildReport): string[] {
  const actions = report.actions;

  if (!actions)
    return ["actions: not audited by this build (older @rsc-kit/core)"];
  if (actions.length === 0) return ["actions: none"];

  const bare = actions.filter((a) => !a.client);
  const lines = [
    `actions: ${actions.length}, ${actions.length - bare.length} built from an action client`,
  ];

  if (bare.length > 0) {
    lines.push(
      `${bare.length} run NO middleware — nothing checks who calls them: ` +
        bare
          .map((a) => `${a.name}${a.query ? " (query)" : ""} in ${a.file}`)
          .join(", "),
      'Fine for a public action. For anything else, build it from an action client so the check cannot be forgotten — how_to({ topic: "action-client" }).',
    );
  }

  return lines;
}
