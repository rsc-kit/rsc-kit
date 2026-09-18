import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unrollBarrelImports } from "../../src/barrelImports";

/**
 * A named import from a barrel of default re-exports is rewritten to the
 * module that owns the name, so a server environment that does not
 * pre-bundle the package loads one file instead of fifteen hundred.
 */
function fakeLucide(): string {
  const root = mkdtempSync(join(tmpdir(), "barrel-"));
  const lines: string[] = [];

  mkdirSync(join(root, "icons"), { recursive: true });

  for (let i = 0; i < 120; i++) {
    const file = `icon-${i}.mjs`;

    writeFileSync(join(root, "icons", file), "export default 1;\n");
    lines.push(
      `export { default as Icon${i}, default as Icon${i}Icon } from './icons/${file}';`,
    );
  }

  lines.push(
    "export { default as ArrowRight, default as ArrowRightIcon } from './icons/icon-1.mjs';",
  );
  lines.push("export { createLucideIcon } from './createLucideIcon.mjs';");
  writeFileSync(join(root, "index.mjs"), lines.join("\n") + "\n");

  return join(root, "index.mjs");
}

describe("a named import from a barrel", () => {
  const entry = fakeLucide();
  const resolve = (s: string) => (s === "lucide-react" ? entry : null);

  test("is rewritten to the module that owns each name, aliases kept", () => {
    const out = unrollBarrelImports(
      `import { ArrowRight, Icon3 as Third, XIcon } from 'lucide-react'\nexport const a = 1`,
      resolve,
    )!;

    expect(out).toContain(
      `import ArrowRight from "${join(entry, "..", "icons", "icon-1.mjs")}";`,
    );
    expect(out).toContain(
      `import Third from "${join(entry, "..", "icons", "icon-3.mjs")}";`,
    );
    // A name the barrel does not map that way stays on the package.
    expect(out).toContain(`import { XIcon } from "lucide-react";`);
    expect(out).toContain("export const a = 1");
  });

  test("leaves everything else alone", () => {
    expect(
      unrollBarrelImports(`import { x } from './local'`, resolve),
    ).toBeNull();
    expect(
      unrollBarrelImports(`import type { Props } from 'lucide-react'`, resolve),
    ).toBeNull();
    expect(unrollBarrelImports(`import { z } from 'zod'`, resolve)).toBeNull();
    expect(unrollBarrelImports(`const n = 1`, resolve)).toBeNull();
  });

  test("a small re-export module is not a barrel", () => {
    const root = mkdtempSync(join(tmpdir(), "small-"));

    writeFileSync(join(root, "a.mjs"), "export default 1;\n");
    writeFileSync(
      join(root, "index.mjs"),
      "export { default as A } from './a.mjs';\n",
    );

    expect(
      unrollBarrelImports(`import { A } from 'small'`, () =>
        join(root, "index.mjs"),
      ),
    ).toBeNull();
  });
});
