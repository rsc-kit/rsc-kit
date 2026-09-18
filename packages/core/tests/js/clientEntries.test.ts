import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { clientEntries, clientScanPlugin } from "../../src/clientEntries.js";

/**
 * Vite's scanner has to see the client components at startup, or the first
 * visit to a page using a new dependency re-optimises everything under a
 * running page. The "use client" files are what it is handed.
 */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "client-entries-"));

  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body);
  }

  return root;
}

describe("the client files handed to the dependency scanner", () => {
  test("are the files that carry the directive, however it is written", () => {
    const root = tree({
      "components/Sheet.tsx": "'use client'\nexport const Sheet = () => null\n",
      "components/Dialog.tsx":
        '// a comment first\n"use client";\nexport const Dialog = () => null\n',
      "app/page.tsx": "export default function Page() { return null }\n",
      "lib/auth.ts": "import { cache } from '@rsc-kit/core/cache'\n",
      "types.d.ts": "'use client'\n",
      "node_modules/dep/index.tsx": "'use client'\n",
    });

    expect(clientEntries(root).map((p) => p.slice(root.length + 1))).toEqual([
      "components/Dialog.tsx",
      "components/Sheet.tsx",
    ]);
  });

  test("and a directory that is not there is no files", () => {
    expect(clientEntries("/nowhere/at/all")).toEqual([]);
  });
});

describe("what the scanner may follow from them", () => {
  const plugin = clientScanPlugin();

  test("the runtime's own modules are external, as in the server bundles", () => {
    expect(plugin.resolveId("bun")).toEqual({ id: "bun", external: true });
    expect(plugin.resolveId("bun:sqlite")).toEqual({
      id: "bun:sqlite",
      external: true,
    });
    expect(plugin.resolveId("bunyan")).toBeNull();
    expect(plugin.resolveId("@repo/database")).toBeNull();
  });

  test('a "use server" module scans as empty: the browser gets a proxy, never its imports', () => {
    const root = tree({
      "actions/auth.ts":
        "'use server'\nimport { db } from '@repo/database'\nexport async function signIn() { db }\n",
      "components/Form.tsx":
        "'use client'\nimport { signIn } from '../actions/auth'\n",
      "lib/util.ts": "export const x = 1\n",
    });

    expect(plugin.load(join(root, "actions/auth.ts"))).toBe("export {};");
    expect(plugin.load(join(root, "actions/auth.ts") + "?v=1")).toBe(
      "export {};",
    );
    expect(plugin.load(join(root, "components/Form.tsx"))).toBeNull();
    expect(plugin.load(join(root, "lib/util.ts"))).toBeNull();
    expect(plugin.load(join(root, "missing.ts"))).toBeNull();
    expect(plugin.load(join(root, "node_modules/dep/index.ts"))).toBeNull();
  });
});
