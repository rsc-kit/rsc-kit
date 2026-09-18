import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * A named import from a barrel, rewritten to the module that owns the name.
 *
 * `import { ArrowRight } from 'lucide-react'` reaches a file that re-exports
 * fifteen hundred icons, one module each. The browser gets the package
 * pre-bundled; the server environments do not, on purpose - a package with
 * a "use client" file stays as files so a client reference resolves to a
 * real one - so Vite loaded and transformed every icon module on the first
 * request. Measured: 3,700 transforms and twenty-five seconds before the
 * first document, for thirteen icons. Next rewrites these imports for the
 * same reason (optimizePackageImports); this does it for the packages it
 * finds barrels in, by reading the barrel.
 *
 * The map from export name to file is read from the barrel's own
 * `export { default as Name } from './x.mjs'` lines, once per barrel, so no
 * package needs a table here. A name the barrel does not map that way - a
 * component exported from the package's own source, say - is left on the
 * original import and resolves as before.
 */

const REEXPORT = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const NAMED_IMPORT =
  /^([ \t]*)import\s*(type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\4\s*;?[ \t]*$/gm;

/** Which packages to unroll: a barrel is any entry whose exports are mostly re-exports of default exports. */
const barrels = new Map<string, Map<string, string> | null>();

function readBarrel(entry: string): Map<string, string> | null {
  const cached = barrels.get(entry);

  if (cached !== undefined) return cached;

  let map: Map<string, string> | null = null;

  try {
    const source = readFileSync(entry, "utf-8");
    const found = new Map<string, string>();

    for (const m of source.matchAll(REEXPORT)) {
      const file = resolve(dirname(entry), m[2]);

      for (const spec of m[1].split(",")) {
        const part = spec.trim().match(/^default\s+as\s+([A-Za-z_$][\w$]*)$/);

        if (part) found.set(part[1], file);
      }
    }

    // Under a hundred names is a module with a few re-exports, not a barrel
    // worth unrolling; the cost this pays for is the long tail.
    map = found.size >= 100 ? found : null;
  } catch {
    map = null;
  }

  barrels.set(entry, map);

  return map;
}

/**
 * Rewrite the named imports in `code` whose package resolves to a barrel.
 * `resolveEntry` answers a bare specifier with the file Vite would load for
 * it, or null. Returns null when nothing changed.
 */
export function unrollBarrelImports(
  code: string,
  resolveEntry: (specifier: string) => string | null,
): string | null {
  if (!code.includes("import")) return null;

  let changed = false;

  const out = code.replace(
    NAMED_IMPORT,
    (whole, indent: string, typeOnly, names: string, _q, specifier: string) => {
      if (typeOnly || specifier.startsWith(".") || specifier.startsWith("/"))
        return whole;

      const entry = resolveEntry(specifier);
      const map = entry && existsSync(entry) ? readBarrel(entry) : null;

      if (!map) return whole;

      const kept: string[] = [];
      const direct: string[] = [];

      for (const spec of names.split(",")) {
        const s = spec.trim();

        if (!s) continue;

        const m = s.match(
          /^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/,
        );
        const exported = m?.[1];
        const local = m?.[2] ?? exported;
        const file =
          exported && !s.startsWith("type ") ? map.get(exported) : undefined;

        if (file && local)
          direct.push(`${indent}import ${local} from ${JSON.stringify(file)};`);
        else kept.push(s);
      }

      if (direct.length === 0) return whole;

      changed = true;

      const rest = kept.length
        ? `${indent}import { ${kept.join(", ")} } from ${JSON.stringify(specifier)};\n`
        : "";

      return rest + direct.join("\n");
    },
  );

  return changed ? out : null;
}
