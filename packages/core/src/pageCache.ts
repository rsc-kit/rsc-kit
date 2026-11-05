// A page a shared cache may keep: `export const revalidate = N`.
//
// The page is rendered whole, judged, then sent. Public only when every check
// passed for that render; otherwise `private, no-store`, exactly as before,
// with `Cache-Status: rsc-kit; fwd=bypass; detail=<check>` saying which one
// failed and a line in the log saying where. Cache-Control is the contract a
// host caches by; Cache-Status is for counting and for the developer asking
// why a page was not kept.
//
// The checks, in the order they can be made:
//
//   1. payload-url - a GET or HEAD, and a payload asked for at its own `?_rsc=<key>` url, and a
//                    document never at one: a cache that ignores Vary keys on
//                    the url alone, so either the other way round hands one
//                    kind of answer to a request for the other
//   2. the render read nothing that belongs to one visitor: cookies(),
//      headers(), request(), connection() - in the page, a layout, a
//      Suspense'd child, metadata or middleware.ts
//   3. host-middleware - Laravel route middleware runs against the session
//   4. set-cookie  - nothing set a cookie
//   5. nonce       - no CSP nonce, which a shared copy would give everyone
//   6. status      - 200 or 404; a redirect, a 5xx or a render React reported
//                    as failed inside the payload (failed-render) never is
//
// A public answer carries `Cache-Tag`: the tags of every cache() answer the
// render used, so a CDN can purge the copy when one of them changes.
//
// Backends render as nobody - see renderAsNobody() - so a session cookie set
// by the backend on every call does not make every page private.

import { HEADER, PER_CLIENT } from "./headers.js";
import { PAYLOAD_PARAM, payloadKey, withoutPayloadKey } from "./js/payloadKey.js";
import { cacheTagsRead, renderFailed, visitorReads } from "./request.js";

/** What a request for a `revalidate` page carries from the moment it arrives. */
export interface PageCaching {
  /** Seconds a shared cache may keep the page. */
  revalidate: number;
  /** The url path, for the log line. */
  path: string;
  /** A check that failed before anything rendered, or after the page said notFound(). */
  refused: string | null;
}

/** A 404 is kept no longer than this, however long its page may be. */
const NOT_FOUND_LIMIT = 60;

/** How long a cache may serve a stale page while one request refreshes it. */
const STALE_WINDOW = 86_400;

const caching = new WeakMap<Request, PageCaching>();

/**
 * Decide, for a request as it arrived, whether its answer may be judged at all.
 *
 * Null for anything but a GET or HEAD of a page that exports revalidate - the
 * answer is then what it always was. Keyed by the request the app sees, so the
 * entry in front, which renders a 404, finds it again.
 */
export function cachingFor(arrived: Request, revalidate: number | undefined): PageCaching | null {
  // A post is never kept, and its answer already says so.
  if (!revalidate || revalidate <= 0 || (arrived.method !== "GET" && arrived.method !== "HEAD")) return null;

  const url = new URL(arrived.url);
  const entry: PageCaching = { revalidate, path: url.pathname, refused: urlRefusal(arrived, url) };

  caching.set(withoutPayloadKey(arrived), entry);

  return entry;
}

/** What cachingFor() decided for this request, if anything. */
export function cachingOf(request: Request): PageCaching | null {
  return caching.get(withoutPayloadKey(request)) ?? null;
}

/**
 * Check 1. A payload answers at `?_rsc=<key>`, with the key its headers give;
 * a document never answers there. Either way round, a cache keying on the url
 * alone would hand a request one kind of answer for the other.
 */
function urlRefusal(arrived: Request, url: URL): string | null {
  const key = url.searchParams.get(PAYLOAD_PARAM);
  const payload = arrived.headers.get(HEADER.rsc) !== null;

  if (payload ? key !== payloadKey(arrived.headers) : key !== null) return "payload-url";

  return null;
}

/**
 * Note what the render has read so far, for an answer that will be finished
 * somewhere else: the page said notFound(), and the entry in front renders
 * not-found.tsx in a scope of its own, where these reads are gone.
 */
export function noteReadsSoFar(entry: PageCaching): void {
  entry.refused ??= readRefusal();
}

function readRefusal(): string | null {
  if (renderFailed()) return "failed-render";

  const read = visitorReads()[0];

  return read ?? null;
}

/** The detail token a read is reported under: `cookies() in Header` is `cookies`. */
function detailOf(refused: string): string {
  return refused.replace(/\(.*$/, "").replace(/[^a-z-]/gi, "-");
}

const logged = new Set<string>();

const REASONS: Record<string, string> = {
  "payload-url":
    "a payload was asked for without its ?_rsc= key, or a document with one. The router always adds it; this was another client.",
  "host-middleware": "the route has host middleware, which runs against the visitor's session.",
  "set-cookie": "the answer set a cookie.",
  nonce: "the answer carries a CSP nonce, which a shared copy would give every visitor.",
  status: "only a 200 or a 404 is kept.",
  "failed-render": "React reported a failure inside the payload.",
};

/** Once per page and reason: a page refused on every request says so once. */
function logRefusal(entry: PageCaching, refused: string): void {
  const key = `${entry.path}\n${refused}`;

  if (logged.has(key) || logged.size > 500) return;

  logged.add(key);

  // A read names what read, and where: `cookies() in Header`.
  const why = REASONS[refused] ?? `${refused} reads this visitor.`;

  console.warn(`[rsc-kit] ${entry.path} exports revalidate, and was sent private: ${why}`);
}

function bypass(response: Response, body: BodyInit | null, entry: PageCaching, refused: string): Response {
  const headers = new Headers(response.headers);

  headers.set("Cache-Control", PER_CLIENT);
  headers.set("Cache-Status", `rsc-kit; fwd=bypass; detail=${detailOf(refused)}`);
  headers.delete("ETag");
  logRefusal(entry, refused);

  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * What a public answer says: kept by shared caches for N seconds, refreshed
 * in the background for a day after that, never by the browser. A 404 for at
 * most a minute, so a scanner walking random urls cannot hold pages out.
 */
export function publicCacheControl(revalidate: number, status: number): string {
  return status === 404
    ? `public, max-age=0, s-maxage=${Math.min(revalidate, NOT_FOUND_LIMIT)}, stale-while-revalidate=${NOT_FOUND_LIMIT}`
    : `public, max-age=0, s-maxage=${revalidate}, stale-while-revalidate=${STALE_WINDOW}`;
}

/** A tag a Cache-Tag list can carry: visible ASCII, no comma, which separates them. */
const TAG = /^[\x21-\x2b\x2d-\x7e]+$/;

let warnedTag = false;

/**
 * The tags of every cache() answer a kept page used, as a CDN reads them:
 * `Cache-Tag: pages,post:1`. A purge by any of them drops the copy. A tag the
 * header cannot carry is left out, and said once: the copy then goes stale on
 * its own time, not on that change.
 */
export function cacheTagHeader(tags: readonly string[]): string | null {
  const kept = tags.filter((tag) => TAG.test(tag));

  if (kept.length < tags.length && !warnedTag) {
    warnedTag = true;
    const bad = tags.find((tag) => !TAG.test(tag));
    console.warn(
      `[rsc-kit] cache() tag ${JSON.stringify(bad)} cannot go in a Cache-Tag header (a comma, a space or a non-ASCII letter), so a CDN cannot purge by it.`,
    );
  }

  return kept.length ? kept.join(",") : null;
}

async function etagOf(body: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  let hex = "";

  for (let i = 0; i < 12; i++) hex += digest[i].toString(16).padStart(2, "0");

  return `"${hex}"`;
}

function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;

  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === etag || tag === "*");
}

/**
 * Finish the answer to a `revalidate` page: rendered whole, then judged.
 *
 * Called inside the request's scope, after every header the request will get
 * is on the answer - cookies included - so what it judges is what is sent.
 * Reading the body to its end is what waits for the render: a Suspense'd
 * child that reads cookies() is still running when the headers exist.
 */
export async function finishCacheable(
  request: Request,
  response: Response,
  entry: PageCaching,
  /**
   * Whether the answer turned out to be not-found.tsx, asked once the body is
   * read: a page can say notFound() in the middle of its stream, after a 200
   * went out. A payload is a 200 either way - the router reads the page from
   * it - but a not-found one is kept no longer than a 404.
   */
  saidNotFound: () => boolean = () => false,
): Promise<Response> {
  if (entry.refused) return bypass(response, response.body, entry, entry.refused);

  if (response.status !== 200 && response.status !== 404) return bypass(response, response.body, entry, "status");

  const type = response.headers.get("Content-Type") ?? "";

  if (!type.startsWith("text/html") && !type.startsWith("text/x-component")) {
    return bypass(response, response.body, entry, "status");
  }

  const body = await response.arrayBuffer();
  const refused =
    readRefusal() ??
    (response.headers.getSetCookie().length > 0 ? "set-cookie" : null) ??
    (/'nonce-/.test(response.headers.get("Content-Security-Policy") ?? "") ? "nonce" : null);

  if (refused) return bypass(response, body, entry, refused);

  const headers = new Headers(response.headers);
  const etag = await etagOf(body);

  headers.set("Cache-Control", publicCacheControl(entry.revalidate, saidNotFound() ? 404 : response.status));
  headers.set("ETag", etag);

  const tags = cacheTagHeader(cacheTagsRead());

  if (tags) headers.set("Cache-Tag", tags);

  if (response.status === 200 && matches(request.headers.get("If-None-Match"), etag)) {
    headers.delete("Content-Length");

    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === "HEAD" ? null : body, { status: response.status, statusText: response.statusText, headers });
}
