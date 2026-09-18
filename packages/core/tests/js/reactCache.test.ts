import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { reactCacheImports } from "../../src/reactCache.js";

/**
 * React's cache() dedupes only inside a component render; in a guard or an
 * action it calls straight through, silently. The build names the server
 * files that import it, so the difference is not found by counting queries.
 */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "react-cache-"));

  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body);
  }

  return root;
}

describe("server files importing cache from react", () => {
  test("are named, by the import or by React.cache()", () => {
    const root = tree({
      "lib/auth.ts":
        "import { cache } from 'react'\nexport const user = cache(async () => 1)\n",
      "lib/data.ts":
        "import React from 'react'\nexport const rows = React.cache(async () => [])\n",
      "lib/fine.ts":
        "import { cache } from '@rsc-kit/core/cache'\nexport const ok = cache(async () => 1)\n",
    });

    expect(reactCacheImports(root)).toEqual(["lib/auth.ts", "lib/data.ts"]);
  });

  test("a client file is not - React's is a no-op there either way", () => {
    const root = tree({
      "components/Thing.tsx":
        "'use client'\nimport { cache, useState } from 'react'\n",
      "components/Other.tsx":
        "// a comment first\n\"use client\";\nimport { cache } from 'react'\n",
    });

    expect(reactCacheImports(root)).toEqual([]);
  });

  test("nor a type-only import, a declaration file, or node_modules", () => {
    const root = tree({
      "lib/types.ts": "import type { cache } from 'react'\n",
      "lib/shim.d.ts": "import { cache } from 'react'\n",
      "node_modules/dep/index.ts": "import { cache } from 'react'\n",
    });

    expect(reactCacheImports(root)).toEqual([]);
  });
});
