import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The app's "use client" files, for Vite's dependency scanner.
 *
 * Vite pre-bundles the browser's dependencies once, at startup, from what it
 * can reach by crawling the client entry. Here that entry imports the engine
 * and React and nothing else: an app's client components are reached through
 * RSC payloads, lazily, page by page. So the first visit to a page that uses
 * base-ui, or lucide, or a form library, discovered a dependency the scanner
 * never saw, and Vite re-optimised everything mid-session: new hashes for
 * every pre-bundle, modules already in memory still pointing at the old
 * React, the new page's modules at the new one - two Reacts, a null hook
 * dispatcher, React unmounting the document. Blank, then Vite's own reload.
 *
 * Handing the scanner every "use client" file up front is what Next's
 * bundler gets for free by walking one graph. The scanner follows imports,
 * so a component without the directive that a client file imports is
 * covered too; a server file is never scanned, so a server-only dependency
 * is never pre-bundled for the browser by mistake.
 */
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const CLIENT = directive("use client");
const SERVER = directive("use server");

function directive(name: string): RegExp {
  return new RegExp(
    `^\\s*(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/\\s*)*["']${name}["']`,
  );
}

function head(file: string): string | null {
  try {
    return readFileSync(file, "utf-8").slice(0, 2048);
  } catch {
    return null;
  }
}

export function clientEntries(sourceDir: string): string[] {
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

      const source = head(path);

      if (source !== null && CLIENT.test(source)) found.push(path);
    }
  };

  walk(sourceDir);

  return found.sort();
}

/**
 * What the scanner may follow from those files: the browser's graph, not
 * the server's.
 *
 * A client component imports a "use server" module to call its actions. In
 * the browser build that module is replaced by a proxy of its exports, and
 * nothing below it - the database, the runtime's own `bun` modules - is
 * ever bundled. The scanner runs before that replacement exists, follows
 * the raw file, reaches `import { SQL } from "bun"`, and gives up on the
 * whole scan: "Failed to run dependency scan", nothing pre-bundled, and the
 * re-optimisation the entries were meant to prevent. So an action module
 * scans as empty, and a runtime builtin is external here as it is in the
 * server bundles.
 */
export function clientScanPlugin(): {
  name: string;
  resolveId(id: string): { id: string; external: true } | null;
  load(id: string): string | null;
} {
  return {
    name: "rsc-kit:client-scan",
    resolveId(id) {
      return id === "bun" || id.startsWith("bun:")
        ? { id, external: true }
        : null;
    },
    load(id) {
      const file = id.split("?")[0];

      if (file.includes("/node_modules/") || !SOURCE.test(file)) return null;

      const source = head(file);

      return source !== null && SERVER.test(source) ? "export {};" : null;
    },
  };
}
