// Compression for what the host answers, where nothing in front of it will.
//
// Behind Cloudflare, Vercel or nginx the platform compresses and this never
// runs. A bun or node server answering the internet by itself sent every
// byte raw - a 90 kB document and 145 kB of stylesheet at their full size -
// and that alone was the mobile Lighthouse regression a port measured:
// first paint at 3.8 s where 1.2 s was the baseline. Public assets are
// precompressed by the build and served by Nitro with their encoding; the
// pages, payloads, stored answers and api routes come through here.
//
// gzip, flushed on every chunk. A streamed page is a shell followed by the
// holes as they fill, and a compressor left to its own buffer would hold
// the shell back until enough had accumulated - so each write is flushed
// out, which costs a little ratio and keeps the stream a stream.

import { deflate } from "./compressRuntime.js";

/** What is worth compressing: text of every kind, and the formats that are text. */
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json|rss\+xml|atom\+xml)|image\/svg\+xml)/i;

/** Answers too small to be worth a compressor's frame. */
const MIN_BYTES = 1024;

/** Stored answers, compressed once: the same bytes go to every visitor who accepts gzip. */
const stored = new Map<string, Uint8Array>();

const STORED_CAP = 1000;

function acceptsGzip(request: Request): boolean {
  const accept = request.headers.get("accept-encoding") ?? "";

  return /(?:^|,)\s*(?:gzip|\*)\s*(?:;\s*q=(?!0(?:\.0*)?\s*(?:,|$)))?/i.test(accept);
}

/** Whether this answer is one to compress at all. */
export function shouldCompress(request: Request, response: Response): boolean {
  if (response.body === null || request.method === "HEAD") return false;
  if (response.status === 204 || response.status === 304 || response.status < 200) return false;
  if (response.headers.has("content-encoding")) return false;
  if (/\bno-transform\b/i.test(response.headers.get("cache-control") ?? "")) return false;
  if (!COMPRESSIBLE.test(response.headers.get("content-type") ?? "")) return false;

  const length = Number(response.headers.get("content-length"));

  if (Number.isFinite(length) && length > 0 && length < MIN_BYTES) return false;

  return acceptsGzip(request);
}

function withEncoding(response: Response, body: BodyInit): Response {
  const headers = new Headers(response.headers);

  headers.set("Content-Encoding", "gzip");
  headers.delete("Content-Length");

  const vary = headers.get("Vary");

  if (!vary) headers.set("Vary", "Accept-Encoding");
  else if (!/\baccept-encoding\b/i.test(vary) && vary.trim() !== "*") headers.set("Vary", vary + ", Accept-Encoding");

  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * The response, gzipped if the request accepts it and the answer is worth it.
 *
 * `storedKey` names an answer the build wrote - the same bytes for every
 * visitor - so it is compressed once and kept; everything else is streamed
 * through the compressor as it is produced.
 */
export async function compressed(
  request: Request,
  response: Response,
  storedKey?: string,
): Promise<Response> {
  if (!shouldCompress(request, response)) return response;

  const gzip = await deflate();

  if (!gzip) return response;

  if (storedKey !== undefined) {
    let bytes = stored.get(storedKey);

    if (!bytes) {
      bytes = await gzip.whole(new Uint8Array(await response.arrayBuffer()));

      if (stored.size >= STORED_CAP) stored.clear();

      stored.set(storedKey, bytes);
    }

    return withEncoding(response, bytes as unknown as BodyInit);
  }

  return withEncoding(response, gzip.stream(response.body!));
}

/** For a test, or a redeploy that reuses the process: forget the stored bytes. */
export function forgetCompressed(): void {
  stored.clear();
}
