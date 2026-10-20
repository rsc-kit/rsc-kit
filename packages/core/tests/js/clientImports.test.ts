import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

import {
  CLIENT_ONLY_APIS,
  packageOf,
  serverImportsOfClientPackages,
} from "../../src/clientImports.js";

/**
 * The line that would have pointed at sheet.tsx in seconds: which server
 * files reach a hook on the server - their own, or a library's - with the
 * package and the hook, imported from where. And only those: it used to name
 * every server file importing a React package, 26 of them on a real app, and
 * the one that mattered was lost in the icons.
 */
const src = "/app/src";
const nm = "/app/node_modules";
const reference = 'import * as $$ReactServer from "x"; export const Thing = $$ReactServer.registerClientReference(() => {}, "id", "Thing")';

function graph(edges: Record<string, string[]>, code: Record<string, string> = {}) {
  const importers = new Map<string, string[]>();

  for (const [id, deps] of Object.entries(edges))
    for (const dep of deps)
      importers.set(dep, [...(importers.get(dep) ?? []), id]);

  return {
    moduleIds: () =>
      new Set([...Object.keys(edges), ...Object.values(edges).flat()]),
    importedIds: (id: string) => edges[id] ?? [],
    importers: (id: string) => importers.get(id) ?? [],
    code: (id: string) => code[id] ?? "export {}",
  };
}

describe("server files reaching client-only React", () => {
  test("a library whose server-run code calls a hook: the file, the package, the hook and the importer", () => {
    const found = serverImportsOfClientPackages(
      graph(
        {
          [`${src}/app/broken/page.tsx`]: [`${src}/components/wrapped.tsx`],
          [`${src}/components/wrapped.tsx`]: [`${nm}/hooky/index.js`],
          [`${nm}/hooky/index.js`]: [`${nm}/hooky/state.js`],
        },
        { [`${nm}/hooky/state.js`]: "export const s = () => (0, import_react.useState)(0)" },
      ),
      { sourceDir: src, clientPackages: ["hooky"] },
    );

    expect(found).toEqual([
      { file: "components/wrapped.tsx", packages: ["hooky"], calls: ["useState"], from: "app/broken/page.tsx" },
    ]);
  });

  test("a server file of the app's own that calls a hook - the shadcn file that lost its directive", () => {
    const found = serverImportsOfClientPackages(
      graph(
        { [`${src}/components/ui/sheet.tsx`]: [`${nm}/@base-ui/react/dialog/index.mjs`] },
        { [`${src}/components/ui/sheet.tsx`]: "import { useState } from 'react'\nexport function Sheet() { const [open] = useState(false) }" },
      ),
      { sourceDir: src, clientPackages: ["@base-ui/react"] },
    );

    expect(found).toEqual([{ file: "components/ui/sheet.tsx", packages: [], calls: ["useState"], from: null }]);
  });

  test("a package that carries its own \"use client\" is a reference, and nothing behind it counts", () => {
    const found = serverImportsOfClientPackages(
      graph(
        {
          [`${src}/app/layout.tsx`]: [`${nm}/next-themes/dist/index.mjs`, `${nm}/@base-ui/react/button/index.mjs`],
          [`${nm}/@base-ui/react/button/index.mjs`]: [`${nm}/@base-ui/react/button/Button.mjs`],
          [`${nm}/@base-ui/react/button/Button.mjs`]: [`${nm}/@base-ui/utils/useRefWithInit.mjs`],
        },
        {
          [`${nm}/next-themes/dist/index.mjs`]: reference + "; useState useContext createContext",
          [`${nm}/@base-ui/react/button/Button.mjs`]: reference,
          [`${nm}/@base-ui/utils/useRefWithInit.mjs`]: "React.useRef()",
        },
      ),
      { sourceDir: src, clientPackages: ["next-themes", "@base-ui/react", "@base-ui/utils"] },
    );

    expect(found).toEqual([]);
  });

  test("icons, markdown and server-only libraries that depend on React but call no hook are not named", () => {
    const found = serverImportsOfClientPackages(
      graph(
        {
          [`${src}/app/page.tsx`]: [`${nm}/lucide-react/dist/esm/lucide-react.mjs`, `${nm}/flags/dist/next.js`],
          [`${nm}/lucide-react/dist/esm/lucide-react.mjs`]: [`${nm}/lucide-react/dist/esm/createLucideIcon.mjs`],
        },
        {
          [`${nm}/lucide-react/dist/esm/createLucideIcon.mjs`]: "// renders with useState? no.\nexport const c = () => createElement('svg')",
          [`${nm}/flags/dist/next.js`]: "/* useContext is not used here */ export function flag() {}",
        },
      ),
      { sourceDir: src, clientPackages: ["lucide-react", "flags"] },
    );

    expect(found).toEqual([]);
  });

  test("a hook in a package the file does not import through a React package is not followed", () => {
    const found = serverImportsOfClientPackages(
      graph(
        {
          [`${src}/app/page.tsx`]: [`${nm}/icons/index.js`],
          [`${nm}/icons/index.js`]: [`${nm}/react/index.js`],
        },
        { [`${nm}/react/index.js`]: "export function useState() {}" },
      ),
      { sourceDir: src, clientPackages: ["icons"] },
    );

    expect(found).toEqual([]);
  });

  test("our own package, node_modules, and virtual modules are not reported", () => {
    const found = serverImportsOfClientPackages(
      graph(
        {
          [`${src}/app/page.tsx`]: [`${nm}/@rsc-kit/core/dist/js/Link.js`, "\0virtual:thing"],
          [`${nm}/some-dep/index.js`]: [`${nm}/hooky/index.mjs`],
        },
        {
          [`${nm}/@rsc-kit/core/dist/js/Link.js`]: "useState()",
          [`${nm}/hooky/index.mjs`]: "useState()",
        },
      ),
      { sourceDir: src, clientPackages: ["@rsc-kit/core", "hooky"], ignore: ["@rsc-kit/core"] },
    );

    expect(found).toEqual([]);
  });

  test("a cycle inside a package is read once, not forever", () => {
    const found = serverImportsOfClientPackages(
      graph(
        {
          [`${src}/app/page.tsx`]: [`${nm}/loop/a.js`],
          [`${nm}/loop/a.js`]: [`${nm}/loop/b.js`],
          [`${nm}/loop/b.js`]: [`${nm}/loop/a.js`],
        },
        { [`${nm}/loop/b.js`]: "useRef()" },
      ),
      { sourceDir: src, clientPackages: ["loop"] },
    );

    expect(found[0]?.calls).toEqual(["useRef"]);
  });

  test("packageOf reads scoped and bare names, and ignores queries", () => {
    expect(packageOf(`${nm}/@base-ui/react/dialog/index.mjs?v=1`)).toBe("@base-ui/react");
    expect(packageOf(`${nm}/lucide-react/dist/x.mjs`)).toBe("lucide-react");
    expect(packageOf(`${src}/app/page.tsx`)).toBeNull();
  });
});

describe("the client-only APIs are React's own", () => {
  const require = createRequire(import.meta.url);
  const client = require("react") as Record<string, unknown>;
  const server = require(require.resolve("react").replace(/index\.js$/, "react.react-server.js")) as Record<string, unknown>;

  test("each one React has is missing from its server build", () => {
    for (const api of CLIENT_ONLY_APIS) {
      if (!(api in client)) continue;

      expect({ api, onServer: api in server }).toEqual({ api, onServer: false });
    }
  });

  test("and every hook its server build leaves out is on the list", () => {
    const missing = Object.keys(client).filter((k) => /^use[A-Z]|^createContext$/.test(k) && !(k in server) && !k.startsWith("unstable_"));

    expect(missing.filter((k) => !(CLIENT_ONLY_APIS as readonly string[]).includes(k))).toEqual([]);
  });
});
