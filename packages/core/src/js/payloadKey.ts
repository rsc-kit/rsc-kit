/**
 * A payload's own url.
 *
 * One url answers with a document or with one of several payloads, told apart
 * by `X-RSC*` request headers. A cache that keys on the url alone - Cloudflare
 * ignores `Vary`, and so does a Cache Rule that caches HTML - would hand a
 * payload to a visitor asking for the document, or the other way round, and
 * the page breaks. So a payload request carries `?_rsc=<key>`, a hash of the
 * headers that shape its answer: a different answer is a different url,
 * whatever the cache in front does with `Vary`.
 *
 * The server strips the parameter before anything reads the url, so a page's
 * search params never see it.
 */

export const PAYLOAD_PARAM = "_rsc";

type HeaderSource = Headers | Record<string, string>;

/**
 * djb2 over every `X-RSC*` header, in base 36: short, stable, and the same in
 * every runtime. Headers lowercases the names and iterates them sorted, so the
 * client's plain object and the server's Headers give the same key.
 */
export function payloadKey(headers: HeaderSource): string {
  let hash = 5381;

  new Headers(headers).forEach((value, name) => {
    if (!name.startsWith("x-rsc")) return;

    for (const char of `${name}:${value}\n`) hash = (hash * 33 + char.charCodeAt(0)) | 0;
  });

  return (hash >>> 0).toString(36);
}

/** The url a payload with these headers is asked for at: a path stays a path. */
export function keyedPayloadUrl(url: string, headers: HeaderSource): string {
  const parsed = new URL(url, "http://payload.invalid");

  parsed.searchParams.set(PAYLOAD_PARAM, payloadKey(headers));

  return url[0] === "/" ? parsed.pathname + parsed.search + parsed.hash : parsed.href;
}

/**
 * The request as the app should see it: a payload asked for at its own url
 * (`?_rsc=<key>`, see js/payloadKey.ts) loses the key before routing, search
 * params, a redirect's location or a cache key can read it. The key exists for
 * caches in front that ignore Vary; to the page it is the same url.
 */
export function withoutPayloadKey(request: Request): Request {
  if (request.method !== "GET" && request.method !== "HEAD") return request;

  const kept = stripped.get(request);

  if (kept) return kept;

  const url = new URL(request.url);

  if (!url.searchParams.has(PAYLOAD_PARAM)) return request;

  url.searchParams.delete(PAYLOAD_PARAM);

  const copy = new Request(url, { method: request.method, headers: request.headers, signal: request.signal });

  // The peer address srvx put on the one that arrived. A new Request has no
  // socket, and without this every navigation that carried the key reached
  // the backend as the renderer itself - one throttle for everyone.
  const ip = (request as { ip?: unknown }).ip;

  if (typeof ip === "string") Object.defineProperty(copy, "ip", { value: ip });

  stripped.set(request, copy);

  return copy;
}

// The same copy for the same request, every time. What the app marks on the
// request it saw (a page that said notFound()) is asked about by the entry in
// front, which holds the request as it arrived, key and all.
const stripped = new WeakMap<Request, Request>();
