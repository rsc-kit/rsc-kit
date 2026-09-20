// What stops `bun build --compile --bytecode` from applying, said by name.
//
// Bun compiles bytecode as CommonJS, and in CommonJS `import.meta` does not
// exist: `import.meta.url`, `.dirname`, `.dir` and `.main` are lowered to
// values, and every other form - `.env`, `.filename`, `.resolve`, the object
// itself - fails the bytecode step. Bun then reports "Failed to generate
// bytecode", names no file, and exits 0, so a CI ships a binary that dies at
// boot with "import.meta is only valid inside modules" and reads green.
// The build scans its own server output and names the file and line.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const LOWERED = new Set(["url", "dirname", "dir", "main"]);

/** `import.meta`, and what follows it, at each use outside a comment. */
const USE = /\bimport\.meta\b(?:\s*\??\.\s*([A-Za-z_$][\w$]*))?/g;

export interface ImportMetaUse {
  line: number;
  /** `import.meta.env`, or `import.meta` for the bare object. */
  form: string;
}

/** The uses of `import.meta` in a module that bytecode cannot express. */
export function unlowerableImportMeta(source: string): ImportMetaUse[] {
  const found: ImportMetaUse[] = [];
  const lines = source.split("\n");

  for (const [index, raw] of lines.entries()) {
    const line = raw.trimStart();

    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;

    for (const match of raw.matchAll(USE)) {
      const property = match[1];

      if (property && LOWERED.has(property)) continue;

      found.push({ line: index + 1, form: property ? `import.meta.${property}` : "import.meta" });
    }
  }

  return found;
}

/** Every server module the binary would compile, with its first unlowerable use. */
export function bytecodeBlockers(serverDir: string): { file: string; line: number; form: string }[] {
  const blockers: { file: string; line: number; form: string }[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);

        continue;
      }

      // The stored pages, as one module: their text is data, not code.
      if (!/\.m?js$/.test(entry.name) || entry.name.endsWith("-inline.mjs")) continue;

      const [first] = unlowerableImportMeta(readFileSync(path, "utf-8"));

      if (first) blockers.push({ file: relative(serverDir, path), ...first });
    }
  };

  walk(serverDir);

  return blockers;
}

/** The note the build prints, or null when the binary can take --bytecode. */
export function bytecodeNote(serverDir: string): string | null {
  const blockers = bytecodeBlockers(serverDir);

  if (blockers.length === 0) return null;

  return (
    "bun build --compile --bytecode will not apply to this server: " +
    blockers.map((b) => `${b.file}:${b.line} uses ${b.form}`).join(", ") +
    ". Bytecode is CommonJS, where only import.meta.url, .dirname, .dir and .main can be expressed; " +
    "Bun reports the failure, names no file, and exits 0, so the binary dies at boot. " +
    "--bytecode --format=esm applies regardless."
  );
}
