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

/** Every `X-RSC*` header, lowercased and sorted, so either side computes the same key. */
function shaping(headers: HeaderSource): [string, string][] {
  const entries: [string, string][] = [];
  const add = (name: string, value: string) => {
    const lower = name.toLowerCase();

    if (lower.startsWith("x-rsc")) entries.push([lower, value]);
  };

  if (headers instanceof Headers) headers.forEach((value, name) => add(name, value));
  else for (const [name, value] of Object.entries(headers)) add(name, value);

  return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** djb2 over the shaping headers, in base 36: short, stable, and the same in every runtime. */
export function payloadKey(headers: HeaderSource): string {
  let hash = 5381;

  for (const [name, value] of shaping(headers)) {
    const line = `${name}:${value}\n`;

    for (let i = 0; i < line.length; i++) hash = ((hash << 5) + hash + line.charCodeAt(i)) | 0;
  }

  return (hash >>> 0).toString(36);
}

/** The url a payload with these headers is asked for at. */
export function keyedPayloadUrl(url: string, headers: HeaderSource): string {
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(url);
  const parsed = new URL(url, "http://payload.invalid");

  parsed.searchParams.set(PAYLOAD_PARAM, payloadKey(headers));

  return absolute ? parsed.href : parsed.pathname + parsed.search + parsed.hash;
}

/**
 * The request as the app should see it: a payload asked for at its own url
 * (`?_rsc=<key>`, see js/payloadKey.ts) loses the key before routing, search
 * params, a redirect's location or a cache key can read it. The key exists for
 * caches in front that ignore Vary; to the page it is the same url.
 */
export function withoutPayloadKey(request: Request): Request {
  if (request.method !== "GET" && request.method !== "HEAD") return request;

  const url = new URL(request.url);

  if (!url.searchParams.has(PAYLOAD_PARAM)) return request;

  url.searchParams.delete(PAYLOAD_PARAM);

  return new Request(url, { method: request.method, headers: request.headers, signal: request.signal });
}
