// A Content-Security-Policy that allows the page's own inline code and nothing
// else, on every host - a process, a Worker, a function, an edge, a bucket.
//
// The author names the policy; the engine adds what only it knows: the inline
// scripts and styles each document carries. Two ways, and which one is decided
// by whether the body is known before the headers leave:
//
//   - A body that is whole first - a page the build stored, a kept page, a
//     shell - gets the hash of each inline script and style in it. The same
//     bytes for everyone, so the same header for everyone, and a cache may
//     share both.
//   - A body that streams - a page rendered per request, the holes resumed
//     after a shell - gets a nonce, new for each response, which React puts on
//     every script it writes. A shell's own scripts are already hashed, so a
//     stored shell stays the same bytes for everyone.
//
// The payload a document carries is data blocks (see inlineFlight.ts), which
// no policy judges, so a nonce is needed only for what React writes as a
// stream fills in: `$RC("B:1","S:1")` and its like, which differ by the shape
// of each render and which no hash can know in advance. A nonce is never put
// on anything a cache may share: it would be a secret given to everyone.
//
// Nothing here imports `node:` anything: it runs where the host runs.

/** What `rscKit({ contentSecurityPolicy })` accepts. */
export interface ContentSecurityPolicyOptions {
  /**
   * The policy, one entry per directive: `{ 'img-src': ["'self'", 'data:'] }`.
   * Left out, `default-src 'self'; base-uri 'self'; object-src 'none';
   * style-src-attr 'unsafe-inline'`.
   */
  directives?: Record<string, string | readonly string[]>;
  /** Sent as Content-Security-Policy-Report-Only: reported, never enforced. */
  reportOnly?: boolean;
}

/** The policy as the build hands it to the host. */
export interface ContentSecurityPolicy {
  directives: [string, string[]][];
  reportOnly: boolean;
}

/** What a document's own inline code hashes to, as CSP source expressions. */
export interface InlineHashes {
  scripts: string[];
  styles: string[];
}

export const DEFAULT_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  // A style={{...}} React rendered on the server is a style attribute, which
  // no hash or nonce can allow. An attribute cannot run code.
  "style-src-attr": ["'unsafe-inline'"],
};

/**
 * Directives a `<meta>` policy cannot carry: a browser ignores them there and
 * says so in the console. Only a header delivers them.
 */
const HEADER_ONLY = new Set(["frame-ancestors", "report-uri", "report-to", "sandbox"]);

/**
 * The policy, checked. Refused at build, never trimmed at runtime: a policy
 * quietly not sent is a security header missing from every page.
 */
export function normaliseContentSecurityPolicy(
  raw: ContentSecurityPolicyOptions | undefined,
): ContentSecurityPolicy | undefined {
  if (raw === undefined) return undefined;

  const fail = (why: string): never => {
    throw new Error(`[rsc-kit] contentSecurityPolicy: ${why}`);
  };

  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    fail("an object, as in { directives: { 'img-src': [\"'self'\", 'data:'] } }.");

  for (const key of Object.keys(raw)) {
    if (key !== "directives" && key !== "reportOnly") fail(`${JSON.stringify(key)} is not an option. It takes directives and reportOnly.`);
  }

  if (raw.reportOnly !== undefined && typeof raw.reportOnly !== "boolean") fail("reportOnly is true or false.");

  const given = raw.directives ?? DEFAULT_DIRECTIVES;

  if (given === null || typeof given !== "object" || Array.isArray(given))
    fail("directives is an object of directive names to sources.");

  const directives: [string, string[]][] = [];
  const seen = new Set<string>();

  for (const [rawName, value] of Object.entries(given)) {
    const name = rawName.toLowerCase();

    if (!/^[a-z][a-z-]*$/.test(name)) fail(`${JSON.stringify(rawName)} is not a directive name.`);
    if (seen.has(name)) fail(`${name} is named twice.`);
    seen.add(name);

    const list = typeof value === "string" ? value.split(/\s+/) : Array.isArray(value) ? [...value] : fail(`${name} takes a string or a list of sources.`);
    const sources = list.map((source) => {
      if (typeof source !== "string") fail(`${name} takes a string or a list of sources.`);

      return source.trim();
    }).filter(Boolean);

    for (const source of sources) {
      if (/[\s;,]/.test(source)) fail(`${name}: ${JSON.stringify(source)} is not one source. Give each its own entry.`);
      if (/^'nonce-/i.test(source))
        fail(`${name}: a nonce written into the config is the same on every response, which is no nonce at all. The engine adds one to each response that streams.`);
    }

    directives.push([name, sources]);
  }

  return { directives, reportOnly: raw.reportOnly === true };
}

/**
 * The policy as `vite dev` sends it: the same one, so what it would refuse in
 * production is refused while you work, plus what only development needs.
 *
 *   - `'unsafe-eval'` in script-src. React's development build evaluates code
 *     for its debugging features (owner stacks, server logs replayed in the
 *     browser) and says so in the console when it cannot. Never in a build.
 *   - The dev server's origin, when the page is served from another one (a
 *     backend in front, `devOrigin`): its modules, styles and fonts load from
 *     there, and its HMR socket connects there.
 *
 * Every page renders per request in dev, so every page is allowed by its
 * nonce, where a build hashes the pages it stores. Vite's own inline styles -
 * a CSS update, the error overlay - take the nonce from a
 * `<meta property="csp-nonce">` the page's boot script writes.
 */
export function devContentSecurityPolicy(
  policy: ContentSecurityPolicy,
  options: { origin?: string } = {},
): ContentSecurityPolicy {
  const map = new Map(policy.directives.map(([name, sources]) => [name, [...sources]]));
  const fallback = map.get("default-src");
  const origin = options.origin ? new URL(options.origin).origin : "";
  const socket = origin ? origin.replace(/^http/, "ws") : "";
  // Only to a directive the policy has: one it leaves out falls back to
  // default-src, which gets the same. One the author closed with 'none' stays
  // closed: dev adds what it needs, never what the author refused.
  const plus = (name: string, sources: string[]) => {
    const list = map.get(name);

    if (!list || list.some((source) => /^'none'$/i.test(source))) return;

    for (const source of sources) if (!list.includes(source)) list.push(source);
  };

  // A script-src copied from default-src, as policyValue would, so eval has
  // somewhere to go; a policy restricting no scripts already allows it.
  if (!map.has("script-src") && fallback) map.set("script-src", [...fallback]);

  plus("script-src", ["'unsafe-eval'"]);

  if (origin) {
    for (const name of ["default-src", "script-src", "script-src-elem", "style-src", "style-src-elem", "font-src", "img-src"]) {
      plus(name, [origin]);
    }

    if (!map.has("connect-src") && fallback) map.set("connect-src", [...fallback]);

    plus("connect-src", [origin, socket]);
  }

  return { ...policy, directives: [...map] };
}

/** The header the policy goes out as. */
export function policyHeaderName(policy: ContentSecurityPolicy): string {
  return policy.reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

/**
 * The policy with what the document needs added: its hashes, and a nonce for
 * a response that streams.
 *
 * Added only where the policy restricts scripts (or styles) at all - a
 * script-src, or a default-src it falls back to. A policy that says nothing
 * about scripts allows every one, and a script-src with hashes in it would
 * take that away. And never where the author wrote 'unsafe-inline': a hash or
 * nonce beside it switches it off, which is the opposite of what they asked.
 */
export function policyValue(
  policy: ContentSecurityPolicy,
  extra: { hashes?: InlineHashes | null; nonce?: string | null; for?: "header" | "meta" } = {},
): string {
  const map = new Map(policy.directives.map(([name, sources]) => [name, [...sources]]));
  const nonce = extra.nonce ? `'nonce-${extra.nonce}'` : null;

  const add = (kind: "script" | "style", hashes: readonly string[]) => {
    const own = `${kind}-src`;
    const fallback = map.get("default-src");

    if (!map.has(own) && fallback) map.set(own, [...fallback]);

    for (const name of [own, `${own}-elem`]) {
      const sources = map.get(name);

      if (!sources) continue;
      if (sources.some((source) => /^'(unsafe-inline|none)'$/i.test(source))) continue;

      for (const source of [...hashes, ...(nonce ? [nonce] : [])]) {
        if (!sources.includes(source)) sources.push(source);
      }
    }
  };

  add("script", extra.hashes?.scripts ?? []);
  add("style", extra.hashes?.styles ?? []);

  return [...map]
    .filter(([name]) => extra.for !== "meta" || !HEADER_ONLY.has(name))
    .map(([name, sources]) => (sources.length ? `${name} ${sources.join(" ")}` : name))
    .join("; ");
}

/**
 * The policy as a `<meta>`, for a page a host serves as a file and the engine
 * never answers - a static export. Without the directives only a header can
 * carry, and none at all for a report-only policy, which a `<meta>` cannot be.
 */
export function policyMeta(policy: ContentSecurityPolicy, hashes: InlineHashes): string {
  if (policy.reportOnly) return "";

  const value = policyValue(policy, { hashes, for: "meta" }).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  return `<meta http-equiv="Content-Security-Policy" content="${value}">`;
}

/**
 * The document with its policy in `<head>`: after the charset, which must
 * stay inside the first 1024 bytes, and ahead of every script and style the
 * policy judges.
 */
export function withPolicyMeta(html: string, meta: string): string {
  if (!meta) return html;

  const charset = /<meta\s[^>]*charset[^>]*>/i.exec(html);

  if (charset && charset.index < 1024) {
    const at = charset.index + charset[0].length;

    return html.slice(0, at) + meta + html.slice(at);
  }

  const head = /<head\b[^>]*>/i.exec(html);

  if (!head) return html;

  const at = head.index + head[0].length;

  return html.slice(0, at) + meta + html.slice(at);
}

const ATTRIBUTES = `((?:[^>"']|"[^"]*"|'[^']*')*)`;
const SCRIPT = new RegExp(`<script\\b${ATTRIBUTES}>([\\s\\S]*?)</script\\s*>`, "gi");
const STYLE = new RegExp(`<style\\b${ATTRIBUTES}>([\\s\\S]*?)</style\\s*>`, "gi");

/** The types a browser runs, or that a policy judges as a script anyway. */
const RUN = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
  "importmap",
  "speculationrules",
]);

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i").exec(attributes);

  if (match) return match[1] ?? match[2] ?? match[3] ?? "";

  return new RegExp(`(?:^|\\s)${name}(?:\\s|$)`, "i").test(attributes) ? "" : null;
}

async function sha256(text: string): Promise<string> {
  // The parser normalises line breaks before a browser hashes the element's text.
  const bytes = new TextEncoder().encode(text.replace(/\r\n?/g, "\n"));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";

  for (const byte of digest) binary += String.fromCharCode(byte);

  return `'sha256-${btoa(binary)}'`;
}

/**
 * The hash of every inline script and style in a document: what a policy
 * must name for the document to run as written. A script with a `src` is the
 * policy's origin rules' to judge, and a data block - JSON, a type no browser
 * runs - is not judged at all.
 */
export async function inlineHashes(html: string): Promise<InlineHashes> {
  const scripts = new Set<string>();
  const styles = new Set<string>();

  for (const [, attributes, body] of html.matchAll(SCRIPT)) {
    if (attribute(attributes, "src") !== null) continue;
    if (!RUN.has((attribute(attributes, "type") ?? "").trim().toLowerCase())) continue;
    if (body === "") continue;

    scripts.add(await sha256(body));
  }

  // Scripts out first: a style tag written inside a script's text is not one.
  for (const [, , body] of html.replace(SCRIPT, "").matchAll(STYLE)) {
    if (body === "") continue;

    styles.add(await sha256(body));
  }

  return { scripts: [...scripts].sort(), styles: [...styles].sort() };
}

/** A nonce: 128 random bits, base64. New for every response that streams. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}
