import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The engine's server-side modules must not import a "use client" module of
 * its own. In the rsc environment the plugin replaces such a module with
 * client-reference stubs, and a helper called from there throws "client
 * reference export … is called on server" - which is how every action with
 * a schema failed, from a validating helper the form also uses.
 */
const SRC = join(import.meta.dir, "../../src");

function head(file: string): string {
  return readFileSync(file, "utf-8").slice(0, 512);
}

describe("the engine's server-side modules", () => {
  test("import no client module of the engine's own", () => {
    const offenders: string[] = [];

    for (const name of readdirSync(SRC)) {
      if (!/\.tsx?$/.test(name) || name.endsWith(".d.ts")) continue;

      const source = readFileSync(join(SRC, name), "utf-8");

      for (const match of source.matchAll(
        /from ["']\.\/js\/([A-Za-z0-9_]+)(?:\.js)?["']/g,
      )) {
        const base = join(SRC, "js", match[1]);
        const file = [base + ".tsx", base + ".ts"].find((f) => {
          try {
            readFileSync(f);
            return true;
          } catch {
            return false;
          }
        });

        if (file && /^\s*["']use client["']/.test(head(file))) {
          offenders.push(`${name} -> js/${match[1]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
