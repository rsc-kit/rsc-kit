// `.output/files.json`: what a server in front of the app may answer from
// disk, before the app runs.
//
// Everything under `.output/public` is answered by Nitro's static handler
// before the request reaches the renderer: no middleware.ts, no route.ts,
// no rscKit({ headers }) - those are a page's. A proxy, a CDN or a PHP front
// controller serving these files itself only has to match what that handler
// sends, and the build already knows all of it: the files it wrote, and the
// route rules Nitro serves them under (an asset directory's maxAge is one,
// `/assets/**` immutable; the service worker's `max-age=0` is another). So
// the build says so, rather than every front re-deriving it from a reading of
// Nitro and getting the service worker wrong.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The encodings Nitro precompresses to, by the suffix of the sibling it writes. */
const ENCODINGS: Record<string, string> = { ".br": "br", ".gz": "gzip", ".zst": "zstd" };

export interface FilesManifest {
  v: 1;
  /** The directory the files are in, relative to the manifest. */
  root: string;
  /** Every file a request may be answered with, by url path, sorted. */
  files: string[];
  /**
   * The encodings some files also exist in, as a sibling with the suffix
   * (`/sw.js.br` is `/sw.js` in br). Served with `Content-Encoding` and
   * `Vary: Accept-Encoding` when the request accepts it.
   */
  precompressed: string[];
  /**
   * The headers a file goes out with beyond its Content-Type, in order, each
   * applying to an exact path or, ending in `/**`, to every path under it.
   * A file matched by none gets none.
   */
  headers: { match: string; headers: Record<string, string> }[];
  /** Whether anything of the app's runs for a file: never. */
  middleware: false;
}

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

export function filesManifest(
  publicDir: string,
  routeRules: Record<string, unknown> | undefined,
  options: { root?: string; exclude?: string[] } = {},
): FilesManifest {
  const all: string[] = [];
  const exclude = options.exclude ?? [];

  if (existsSync(publicDir)) {
    walk(publicDir, "", (path) => exclude.some((prefix) => path === prefix || path.startsWith(prefix + "/")), all);
  }

  const present = new Set(all);
  const encodings = new Set<string>();
  const files = all.filter((path) => {
    const suffix = Object.keys(ENCODINGS).find((ext) => path.endsWith(ext));

    if (!suffix || !present.has(path.slice(0, -suffix.length))) return true;

    encodings.add(ENCODINGS[suffix]!);

    return false;
  });

  const headers: FilesManifest["headers"] = [];

  for (const [match, rule] of Object.entries(routeRules ?? {})) {
    const set = (rule as { headers?: Record<string, string> } | null)?.headers;

    // Only the forms a front can follow without Nitro's router - and only a
    // rule some file is under: a rule for pages is the renderer's business.
    if (!set || Object.keys(set).length === 0) continue;
    if (!match.endsWith("/**") ? /[*:]/.test(match) : /[*:]/.test(match.slice(0, -3))) continue;
    if (!files.some((path) => ruleMatches(match, path))) continue;

    headers.push({ match, headers: { ...set } });
  }

  return {
    v: 1,
    root: options.root ?? "public",
    files,
    precompressed: [...encodings].sort(),
    headers,
    middleware: false,
  };
}
