/**
 * Server files that reach client-only React on the server.
 *
 * A server component may import a client library - `<SheetClose>` from
 * base-ui rendered inside server output is legal here and in Next.js. What
 * is worth a line is the shape that cost an afternoon: a file with no
 * "use client" (a shadcn ui/ file that lost its directive in a port) whose
 * code, or a library's under it, calls a hook in the rsc environment, which
 * fails at render as "(0, import_react_react_server.useState) is not a
 * function" - naming React, not the file.
 *
 * This used to name every server file importing any package that depends on
 * React, which on a real app was 26 files of icons, markdown and base-ui
 * parts that carry their own "use client", and the one that mattered was
 * lost among them. So the code is read instead: from the server file into
 * the packages it imports, stopping at a client reference - a module with
 * the directive, whose code never runs on the server - and a file is named
 * only when what is left mentions a React API the server build does not
 * have. Mentions, not calls: a library can hold a hook in an export the
 * page never renders, so the line names the API for the reader to judge.
 *
 * Read off the rsc environment's module graph after it is built. A file with
 * the directive never appears: in that graph it is already a reference, and
 * a reference imports nothing.
 */
export interface ClientLibraryImport {
  /** The server file, relative to the source dir. */
  file: string;
  /** The packages whose server-run code reaches a client-only API, by name. Empty when the file itself does. */
  packages: string[];
  /** The client-only React APIs reached, by name. */
  calls: string[];
  /** The first app file that imports it, relative to the source dir - or null for a route file. */
  from: string | null;
}

export interface ModuleGraph {
  moduleIds(): Iterable<string>;
  importedIds(id: string): readonly string[];
  importers(id: string): readonly string[];
  /** The module's code as built - for a client reference, the reference. */
  code(id: string): string | null;
}

/**
 * React's APIs that its server build leaves out, as of React 19: the ones a
 * render needs state or an effect for. A test reads them off React itself.
 * Not Component or startTransition - the one is a word in every library's
 * prose, the other runs in an event handler, never during a render.
 */
export const CLIENT_ONLY_APIS = [
  "createContext",
  "useActionState",
  "useContext",
  "useDeferredValue",
  "useEffect",
  "useEffectEvent",
  "useFormState",
  "useFormStatus",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
] as const;

const CLIENT_ONLY = new RegExp(`\\b(${CLIENT_ONLY_APIS.join("|")})\\b`, "g");
const COMMENT = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g;

/** plugin-rsc's reference for a "use client" module: its code stays on the client. */
const isReference = (code: string) => code.includes("registerClientReference");

/** The client-only APIs a module's own code mentions, outside its comments. */
function clientOnlyIn(code: string | null): string[] {
  if (!code || isReference(code)) return [];

  return [...new Set([...code.replace(COMMENT, "$1").matchAll(CLIENT_ONLY)].map((m) => m[1]!))];
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
  const inClientPackage = (id: string) => {
    const name = packageOf(id);
    return name !== null && client.has(name) && !ignore.has(name);
  };

  // What a package module and everything it runs on the server reach,
  // memoised: one barrel is imported by many files. A cycle reads as nothing
  // more on its second visit, which is all a union needs.
  const reached = new Map<string, Set<string>>();
  const reach = (id: string): Set<string> => {
    const known = reached.get(id);
    if (known) return known;

    const apis = new Set<string>();
    reached.set(id, apis);

    const code = graph.code(id);
    if (code !== null && isReference(code)) return apis;

    for (const api of clientOnlyIn(code)) apis.add(api);

    for (const next of graph.importedIds(id)) {
      if (inClientPackage(next)) for (const api of reach(next)) apis.add(api);
    }

    return apis;
  };

  for (const id of graph.moduleIds()) {
    if (!isApp(id)) continue;

    const calls = new Set(clientOnlyIn(graph.code(id)));
    const packages = new Set<string>();

    for (const imported of graph.importedIds(id)) {
      if (!inClientPackage(imported)) continue;

      const apis = reach(imported);
      if (apis.size === 0) continue;

      packages.add(packageOf(imported)!);
      for (const api of apis) calls.add(api);
    }

    if (calls.size === 0) continue;

    const from = graph.importers(id).find(isApp);

    out.push({
      file: relative(id),
      packages: [...packages].sort(),
      calls: [...calls].sort(),
      from: from ? relative(from) : null,
    });
  }

  return out.sort((a, b) => a.file.localeCompare(b.file));
}
