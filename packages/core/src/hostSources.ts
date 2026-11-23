// Where the backend's functions are written, for an editor to go to.
//
// The manifest says it as `sources`, by function name, and the build turns it
// into a source map of the rpc() declaration. Nothing the app runs reads it.

/** Where a backend function is written, for the editor to go to. */
export interface HostSource {
  /** Relative to the manifest, with forward slashes. */
  file: string;
  /** 1-based. */
  line: number;
  /** What the backend calls it: App\Rsc\LoginPage::props. */
  name?: string;
}

/**
 * A manifest without where its functions are, for asking whether the backend
 * changed. Their lines move with every edit above them, and a server that
 * restarted for that would restart on every save in the backend.
 */
export function withoutSources(text: string | null): string | null {
  if (text === null) return null;

  try {
    const { sources: _, ...rest } = JSON.parse(text) as Record<string, unknown>;

    return JSON.stringify(rest);
  } catch {
    return text;
  }
}

/**
 * The source map of the overloads in `types`, or null when none of them has a
 * source. `at` answers for a function's name, its file relative to the map.
 */
export function hostSourceMap(
  types: string,
  file: string,
  global: string,
  at: (name: string) => { file: string; line: number } | undefined,
): string | null {
  const lead = "declare function ";
  const sources: string[] = [];
  let mappings = "";
  // Every field is written as its distance from the last one.
  let source = 0;
  let line = 0;

  for (const [i, text] of types.split("\n").entries()) {
    if (i > 0) mappings += ";";

    const name = text.startsWith(lead + global + "<") ? /\(name: ("(?:[^"\\]|\\.)*")/.exec(text)?.[1] : undefined;
    const to = name === undefined ? undefined : at(JSON.parse(name) as string);

    if (!to) continue;

    let index = sources.indexOf(to.file);

    if (index < 0) index = sources.push(to.file) - 1;

    // Where the overload's own name starts, then where it ends: without the
    // second, the rest of the line would be in the backend's file too.
    mappings += vlq(lead.length) + vlq(index - source) + vlq(to.line - 1 - line) + vlq(0);
    mappings += "," + vlq(global.length);
    source = index;
    line = to.line - 1;
  }

  if (sources.length === 0) return null;

  return JSON.stringify({ version: 3, file, sourceRoot: "", sources, names: [], mappings }) + "\n";
}

/** A number as a source map writes it. */
function vlq(value: number): string {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";

  do {
    const digit = rest & 31;
    rest >>>= 5;
    out += digits[rest > 0 ? digit | 32 : digit];
  } while (rest > 0);

  return out;
}
