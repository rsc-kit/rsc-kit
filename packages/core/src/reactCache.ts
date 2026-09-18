import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Server files that import `cache` from React.
 *
 * React's `cache()` memoises on the dispatcher a Flight render installs, and
 * only while that render runs: in a guard, an action, an api route or the
 * SSR pass there is no dispatcher and it calls straight through - no
 * dedupe, no error, the helper simply runs twice. The engine's `cache()`
 * spans the request. The difference is silent, which is why the build says
 * so; a client file is left alone, where React's is a no-op either way.
 */
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;
const NAMED =
  /import\s*(?:type\s+)?\{[^}]*\bcache\b[^}]*\}\s*from\s*["']react["']/;
const MEMBER = /\bReact\.cache\s*\(/;

export function reactCacheImports(sourceDir: string): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    let entries;

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(path);

        continue;
      }

      if (!SOURCE.test(entry.name) || entry.name.endsWith(".d.ts")) continue;

      const text = readFileSync(path, "utf-8");

      if (CLIENT.test(text)) continue;
      if (!NAMED.test(text) && !MEMBER.test(text)) continue;
      if (
        NAMED.test(text) &&
        /import\s+type\s*\{[^}]*\bcache\b/.test(text) &&
        !MEMBER.test(text)
      )
        continue;

      found.push(relative(sourceDir, path));
    }
  };

  walk(sourceDir);

  return found.sort();
}
