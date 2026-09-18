import { describe, expect, test } from "bun:test";

import {
  packageOf,
  serverImportsOfClientPackages,
} from "../../src/clientImports.js";

/**
 * The line that would have pointed at sheet.tsx in seconds: which server
 * files import a client library, with which packages, imported from where.
 */
const src = "/app/src";
const nm = "/app/node_modules";

function graph(edges: Record<string, string[]>) {
  const importers = new Map<string, string[]>();

  for (const [id, deps] of Object.entries(edges))
    for (const dep of deps)
      importers.set(dep, [...(importers.get(dep) ?? []), id]);

  return {
    moduleIds: () =>
      new Set([...Object.keys(edges), ...Object.values(edges).flat()]),
    importedIds: (id: string) => edges[id] ?? [],
    importers: (id: string) => importers.get(id) ?? [],
  };
}

describe("server files importing a client library", () => {
  test("are named with their packages and their importer", () => {
    const found = serverImportsOfClientPackages(
      graph({
        [`${src}/app/(public)/components/mobile-auth-section.tsx`]: [
          `${src}/components/ui/sheet.tsx`,
        ],
        [`${src}/components/ui/sheet.tsx`]: [
          `${nm}/@base-ui/react/dialog/index.mjs`,
          `${nm}/lucide-react/dist/esm/lucide-react.mjs`,
          `${src}/lib/cn.ts`,
        ],
        [`${src}/lib/cn.ts`]: [`${nm}/clsx/dist/clsx.mjs`],
      }),
      {
        sourceDir: src,
        clientPackages: ["@base-ui/react", "lucide-react", "@rsc-kit/core"],
        ignore: ["@rsc-kit/core"],
      },
    );

    expect(found).toEqual([
      {
        file: "components/ui/sheet.tsx",
        packages: ["@base-ui/react", "lucide-react"],
        from: "app/(public)/components/mobile-auth-section.tsx",
      },
    ]);
  });

  test("our own package, node_modules, and virtual modules are not reported", () => {
    const found = serverImportsOfClientPackages(
      graph({
        [`${src}/app/page.tsx`]: [
          `${nm}/@rsc-kit/core/dist/js/Link.js`,
          "\0virtual:thing",
        ],
        [`${nm}/some-dep/index.js`]: [`${nm}/lucide-react/index.mjs`],
      }),
      {
        sourceDir: src,
        clientPackages: ["@rsc-kit/core", "lucide-react"],
        ignore: ["@rsc-kit/core"],
      },
    );

    expect(found).toEqual([]);
  });

  test("a route file with no app importer says so", () => {
    const found = serverImportsOfClientPackages(
      graph({ [`${src}/app/page.tsx`]: [`${nm}/lucide-react/index.mjs`] }),
      { sourceDir: src, clientPackages: ["lucide-react"] },
    );

    expect(found[0]?.from).toBeNull();
  });

  test("packageOf reads scoped and bare names, and ignores queries", () => {
    expect(packageOf(`${nm}/@base-ui/react/dialog/index.mjs?v=1`)).toBe(
      "@base-ui/react",
    );
    expect(packageOf(`${nm}/lucide-react/dist/x.mjs`)).toBe("lucide-react");
    expect(packageOf(`${src}/app/page.tsx`)).toBeNull();
  });
});
