// One render per visit.
//
// Hydrating server components needs the serialised tree, not the HTML, and a
// document does not carry its own payload - inlined, decode and hydration
// become one long task (#231). So the client fetches it, and that fetch used
// to render the whole page a second time: the same reads, the same queries,
// a moment after the document's render had made exactly that payload and
// thrown it away.
//
// Now the document's render keeps its payload here for the few seconds it
// takes the browser to come back for it, under a token written into the
// document that only that browser holds. The boot fetch redeems the token
// and is answered with the payload the document was made from - which is
// also the one it should hydrate against: two renders a moment apart could
// disagree, and the one that made the HTML cannot.
//
// A token is redeemed once. A payload nobody comes back for - a route with
// no runtime, a browser that left, a Worker isolate other than the one that
// rendered - is cancelled when it expires, and the boot fetch that misses
// renders as it always did. Missing costs a render; it never costs a wrong
// answer.

/** How long a payload waits for its browser. */
export const BOOT_HOLD_MS = 10_000;

/** At most this many held at once; the oldest is dropped first. */
const MAX_HELD = 500;

export interface HeldPayload {
  payload: ReadableStream;
  /** The headers the boot answer carries beside the payload: the layout chain, the depth. */
  headers: Record<string, string>;
  at: number;
}

const held = new Map<string, HeldPayload>();

/** A token no one can guess: 128 bits, url-safe. */
export function bootToken(): string {
  const bytes = new Uint8Array(16);

  crypto.getRandomValues(bytes);

  let out = "";

  for (const b of bytes) out += b.toString(16).padStart(2, "0");

  return out;
}

/** Keep a render's payload for the boot fetch that follows its document. */
export function holdBootPayload(
  token: string,
  payload: ReadableStream,
  headers: Record<string, string>,
  now = Date.now(),
): void {
  sweep(now);

  if (held.size >= MAX_HELD) {
    const oldest = held.keys().next().value;

    if (oldest !== undefined) drop(oldest);
  }

  held.set(token, { payload, headers, at: now });
}

/** The payload for a token, once. Null for a token not held, redeemed or expired. */
export function takeBootPayload(token: string, now = Date.now()): HeldPayload | null {
  const found = held.get(token);

  if (!found) return null;

  held.delete(token);

  if (now - found.at >= BOOT_HOLD_MS) {
    void found.payload.cancel().catch(() => {});

    return null;
  }

  return found;
}

/** Let go of what nobody came back for. */
function sweep(now: number): void {
  for (const [token, entry] of held) {
    if (now - entry.at < BOOT_HOLD_MS) break;

    drop(token);
  }
}

function drop(token: string): void {
  const entry = held.get(token);

  held.delete(token);

  if (entry) void entry.payload.cancel().catch(() => {});
}

/** How many are held, for tests. */
export function heldBootPayloads(): number {
  return held.size;
}

/** Forget everything, for tests. */
export function clearBootPayloads(): void {
  for (const token of [...held.keys()]) drop(token);
}
