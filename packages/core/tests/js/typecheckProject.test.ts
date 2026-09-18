import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import { typecheckProject } from "../../src/vite.js";

/**
 * The build runs the project's own typecheck first, so a link to a route that
 * does not exist fails the build and not the visitor. Skipped, not failed,
 * where the project is not doing this checking at all.
 */
function project(files: Record<string, string>, withTypescript = true): string {
  const root = mkdtempSync(join(tmpdir(), "typecheck-"));

  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body);
  }

  if (withTypescript) {
    const typescript = dirname(
      createRequire(import.meta.url).resolve("typescript/package.json"),
    );

    mkdirSync(join(root, "node_modules"), { recursive: true });
    symlinkSync(typescript, join(root, "node_modules/typescript"));
  }

  return root;
}

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
  include: ["src"],
});

describe("the typecheck the build runs first", () => {
  test("passes a project whose types hold", () => {
    const root = project({
      "package.json": "{}",
      "tsconfig.json": tsconfig,
      "src/a.ts": "export const n: number = 1\n",
    });
    const outcome = typecheckProject(root);

    expect(outcome).toMatchObject({ ran: true, ok: true });
  }, 60_000);

  test("fails with tsc's own lines when they do not", () => {
    const root = project({
      "package.json": "{}",
      "tsconfig.json": tsconfig,
      "src/a.ts": 'export const n: number = "one"\n',
    });
    const outcome = typecheckProject(root);

    expect(outcome).toMatchObject({ ran: true, ok: false });
    expect((outcome as { output: string }).output).toContain(
      "src/a.ts(1,14): error TS2322",
    );
  }, 60_000);

  test("is skipped, not failed, with no tsconfig or no typescript", () => {
    expect(typecheckProject(project({ "package.json": "{}" }))).toEqual({
      ran: false,
      because: "no tsconfig",
    });
    expect(
      typecheckProject(
        project({ "package.json": "{}", "tsconfig.json": tsconfig }, false),
      ),
    ).toEqual({
      ran: false,
      because: "no typescript",
    });
  });
});
