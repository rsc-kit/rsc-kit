// `.output/files.json`: what a server in front of the app may answer from
// disk, before the app runs.
//
// Everything under the public directory is answered by Nitro's static
// handler before the request reaches the renderer: no middleware.ts, no
// route.ts, no rscKit({ headers }) - those are a page's. A proxy, a CDN or a
// PHP front controller serving these files itself only has to match what
// that handler sends, and the build already knows all of it: the files it
// wrote, and the route rules Nitro serves them under (an asset directory's
// maxAge is one, `/assets/**` immutable; the service worker's `max-age=0` is
// another). So the build says so, rather than every front re-deriving it from
// a reading of Nitro and getting the service worker wrong.
//
// It fails closed. Nitro's route rules run before its static handler, so a
// rule decides what a file goes out with - and a rule the manifest cannot
// state (`/:name.js`, a redirect, cors, a proxy, a `headers: false` reset)
// would make a front's answer differ from the app's with nobody seeing it.
// A file under such a rule is left out of `files`: the front sends it to the
// app, which answers it the way it always would. Each file is checked against
// Nitro's own matcher (h3's, which Nitro compiles its rules with), not a
// reading of it: what the front would send has to equal what Nitro resolves.

import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The encodings Nitro precompresses to, by the suffix of the sibling it writes. */
const ENCODINGS: Record<string, string> = { ".br": "br", ".gz": "gzip", ".zst": "zstd" };

/**
 * Rules that never touch a file Nitro's static handler answers: `prerender`
 * is build-time, and the cache rule wraps route handlers, which run after it.
 * Any other rule - redirect, proxy, cors, one an app or module added - leaves
 * the file to the app.
 */
const INERT = new Set(["headers", "prerender", "cache"]);

export interface FilesManifest {
  v: 1;
  /** The directory the files are in, relative to the manifest. */
  root: string;
  /**
   * Every file a request may be answered with, by url path, sorted. A path
   * is the file's name as it is on disk, not percent-encoded: a request's
   * path is decoded before it is looked up.
   */
  files: string[];
  /**
   * The encodings some files also exist in, as a sibling with the suffix
   * (`/sw.js.br` is `/sw.js` in br). Served with `Content-Encoding` and
   * `Vary: Accept-Encoding` when the request accepts it.
   */
  precompressed: string[];
  /**
   * The headers a file goes out with beyond its Content-Type, each applying
   * to an exact path or, ending in `/**`, to every path under it. Every entry
   * that matches applies, in order; a later one replaces an earlier one's
   * header of the same name. A file matched by none gets none.
   */
  headers: { match: string; headers: Record<string, string> }[];
  /** Whether anything of the app's runs for a file: never. */
  middleware: false;
}

/** The route rules Nitro resolves for a url path, as its matcher merges them. */
export type ResolveRouteRules = (path: string) => Record<string, unknown>;

function walk(dir: string, base: string, skip: (path: string) => boolean, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const path = `${base}/${name}`;

    if (skip(path)) continue;
    if (statSync(full).isDirectory()) walk(full, path, skip, out);
    else out.push(path);
  }
}

/** Whether a route rule's key matches a path: exact, or `/x/**` for everything under /x. */
export function ruleMatches(rule: string, path: string): boolean {
  if (rule.endsWith("/**")) return path.startsWith(rule.slice(0, -2));

  return rule === path;
}

/** Whether a front can follow a rule's key without Nitro's router. */
function expressible(rule: string): boolean {
  return !/[*:?(){}\\]/.test(rule.endsWith("/**") ? rule.slice(0, -3) : rule);
}

/** The literal part of a pattern, before its first dynamic segment. */
function literalPrefix(rule: string): string {
  const segments = rule.split("/");
  const dynamic = segments.findIndex((segment) => /[*:?(){}\\]/.test(segment));

  return segments.slice(0, dynamic).join("/") + "/";
}

function lower(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
}

function same(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);

  return keys.length === Object.keys(b).length && keys.every((key) => b[key] === a[key]);
}

function headersOf(rule: unknown): Record<string, string> | null {
  const set = (rule as { headers?: unknown } | null)?.headers;

  return set && typeof set === "object" && Object.keys(set).length > 0 ? (set as Record<string, string>) : null;
}

export function filesManifest(
  publicDir: string,
  routeRules: Record<string, unknown> | undefined,
  options: {
    root?: string;
    exclude?: string[];
    /** The app's base url; the files are under it. */
    baseURL?: string;
    /**
     * Nitro's own resolution of a path's rules. Without it a file is checked
     * against the rules by their keys, and one under a pattern the manifest
     * cannot state is left out by the pattern's literal prefix.
     */
    resolve?: ResolveRouteRules | null;
    /** Told about each file left to the app, and why. */
    onLeftOut?: (path: string, why: string) => void;
  } = {},
): FilesManifest {
  const base = (options.baseURL ?? "/").replace(/\/+$/, "");
  const rules = Object.entries(routeRules ?? {});
  const all: string[] = [];
  const exclude = options.exclude ?? [];

  if (existsSync(publicDir)) {
    walk(publicDir, "", (path) => exclude.some((prefix) => path === prefix || path.startsWith(prefix + "/")), all);
  }

  const present = new Set(all);
  const encodings = new Set<string>();
  const listed = all
    .filter((path) => {
      const suffix = Object.keys(ENCODINGS).find((ext) => path.endsWith(ext));

      if (!suffix || !present.has(path.slice(0, -suffix.length))) return true;

      encodings.add(ENCODINGS[suffix]!);

      return false;
    })
    .map((path) => base + path);

  // What a front can state, broadest first: a prefix rule before a longer
  // one, an exact rule last - the order Nitro merges them in, so applying
  // them in turn gives what its matcher resolves.
  const stated = rules
    .filter(([key, rule]) => expressible(key) && headersOf(rule))
    .map(([key, rule]) => ({ match: base + key, headers: { ...headersOf(rule)! } }))
    .sort((a, b) => {
      const rank = (match: string) => (match.endsWith("/**") ? match.length : Number.MAX_SAFE_INTEGER);

      return rank(a.match) - rank(b.match);
    });

  const frontSends = (path: string) =>
    stated.filter((entry) => ruleMatches(entry.match, path)).reduce<Record<string, string>>((out, entry) => ({ ...out, ...lower(entry.headers) }), {});

  const leftOut = (path: string): string | null => {
    if (options.resolve) {
      const resolved = options.resolve(path);
      const active = Object.keys(resolved).find((name) => !INERT.has(name) && resolved[name] !== false && resolved[name] != null);

      if (active) return `a ${active} route rule applies to it`;

      const nitroSends = lower((resolved.headers && typeof resolved.headers === "object" ? resolved.headers : {}) as Record<string, string>);

      return same(nitroSends, frontSends(path)) ? null : "its route rules' headers cannot be stated as exact or /** matches";
    }

    for (const [key, rule] of rules) {
      const match = base + key;

      if (!expressible(key)) {
        if (path.startsWith(base + literalPrefix(key))) return `route rule ${key} cannot be stated as an exact or /** match`;
        continue;
      }
      if (!ruleMatches(match, path)) continue;

      const active = Object.keys((rule as object | null) ?? {}).find(
        (name) => !INERT.has(name) && (rule as Record<string, unknown>)[name] !== false && (rule as Record<string, unknown>)[name] != null,
      );

      if (active) return `a ${active} route rule applies to it`;
      if ((rule as { headers?: unknown } | null)?.headers === false) return `route rule ${key} resets its headers`;
    }

    return null;
  };

  const files = listed.filter((path) => {
    const why = leftOut(path);

    if (why) options.onLeftOut?.(path, why);

    return !why;
  });

  return {
    v: 1,
    root: options.root ?? "public",
    files,
    precompressed: [...encodings].sort(),
    // Only a rule some served file is under: a rule for pages is the renderer's business.
    headers: stated.filter((entry) => files.some((path) => ruleMatches(entry.match, path))),
    middleware: false,
  };
}

/**
 * The route rules Nitro resolves for a path, by the matcher it compiles them
 * with - h3's, loaded from the app's own Nitro so the answer is that
 * version's. Null when it cannot be loaded or refuses the rules: files.json
 * then falls back to the rules' keys, leaving out more rather than less.
 */
export async function nitroRouteRules(
  root: string,
  routeRules: Record<string, unknown> | undefined,
  baseURL: string,
): Promise<ResolveRouteRules | null> {
  try {
    const nitro = createRequire(join(root, "package.json")).resolve("nitro");
    const rules = (await import(pathToFileURL(createRequire(nitro).resolve("h3/rules")).href)) as {
      normalizeRouteRules?: (config: Record<string, unknown>) => Record<string, unknown>;
      createRouteRulesMatcher?: (rules: Record<string, unknown>, options: { baseURL?: string }) => (method: string, path: string) => { routeRules?: Record<string, unknown> };
    };

    if (!rules.normalizeRouteRules || !rules.createRouteRulesMatcher) return null;

    const match = rules.createRouteRulesMatcher(rules.normalizeRouteRules(routeRules ?? {}), { baseURL: baseURL || undefined });

    return (path) => ({ ...(match("GET", path).routeRules ?? {}) });
  } catch {
    return null;
  }
}
