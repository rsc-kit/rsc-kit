/**
 * Server files that import a client library.
 *
 * A server component may import a client library - `<SheetClose>` from
 * base-ui rendered inside server output is legal here and in Next.js. What
 * is worth a line is the shape that cost an afternoon: a file with no
 * "use client" that only wraps client components (a shadcn ui/ file that
 * lost its directive in a port) imported from the server, so the library's
 * internals run in the rsc environment. The build cannot tell the two
 * apart; it can say which server files do it, and with which packages, so
 * the person reading can.
 *
 * Read off the rsc environment's module graph after it is built. A file with
 * the directive never appears: in that graph it is already a reference, and
 * a reference imports nothing.
 */
export interface ClientLibraryImport {
  /** The server file, relative to the source dir. */
  file: string;
  /** The client packages it imports, by name. */
  packages: string[];
  /** The first app file that imports it, relative to the source dir - or null for a route file. */
  from: string | null;
}

export interface ModuleGraph {
  moduleIds(): Iterable<string>;
  importedIds(id: string): readonly string[];
  importers(id: string): readonly string[];
}

const PACKAGE = /\/node_modules\/(@[^/]+\/[^/]+|[^/@][^/]*)/;

/** The package a node_modules id belongs to, or null for anything else. */
export function packageOf(id: string): string | null {
  const match = PACKAGE.exec(id.split("?")[0] ?? id);

  return match ? match[1]! : null;
}

export function serverImportsOfClientPackages(
  graph: ModuleGraph,
  options: {
    sourceDir: string;
    clientPackages: Iterable<string>;
    ignore?: Iterable<string>;
  },
): ClientLibraryImport[] {
  const root = options.sourceDir.replace(/\/+$/, "") + "/";
  const client = new Set(options.clientPackages);
  const ignore = new Set(options.ignore ?? []);
  const isApp = (id: string) =>
    id.startsWith(root) &&
    !id.includes("/node_modules/") &&
    !id.startsWith("\0");
  const relative = (id: string) => (id.split("?")[0] ?? id).slice(root.length);
  const out: ClientLibraryImport[] = [];

  for (const id of graph.moduleIds()) {
    if (!isApp(id)) continue;

    const packages = new Set<string>();

    for (const imported of graph.importedIds(id)) {
      const name = packageOf(imported);

      if (name && client.has(name) && !ignore.has(name)) packages.add(name);
    }

    if (packages.size === 0) continue;

    const from = graph.importers(id).find(isApp);

    out.push({
      file: relative(id),
      packages: [...packages].sort(),
      from: from ? relative(from) : null,
    });
  }

  return out.sort((a, b) => a.file.localeCompare(b.file));
}
