/**
 * The client components a prefetched page uses, loaded before the tap.
 *
 * A payload names each client component it renders by id - a row like
 * `a:I["b2742f3fbb28",[],"AddToCartForm",1]` - and the browser loads the
 * component's chunk when it first renders one. Decoding waits for intent, so
 * that chunk used to start downloading at the touch; on the first product
 * page of a visit it arrived after the page did, and React showed the page's
 * skeleton until it had the code for the form inside it. Every later product
 * found the chunk cached, so only the first one ever showed it. Next loads a
 * prefetched page's chunks as its payload lands; so does this.
 *
 * Imported at idle, never ahead of what the page on screen is doing, and
 * bounded: a landing page whose links lead to a heavy editor must not load the
 * editor for every visitor who never goes there. Nothing is rendered or
 * decoded - a module that is evaluated defines its components and does
 * nothing else. Nothing under Save-Data.
 */

/** Client components per prefetched page. The ones a page renders first come first in its payload. */
const PER_PAGE = 8;
/** Across the document: a page of a hundred links is not a hundred pages of code. */
const PER_DOCUMENT = 64;

const asked = new Set<string>();
let loader: ((id: string) => Promise<unknown> | undefined) | null = null;

/** How a client reference id becomes its chunk - set by the browser entry, which has the map. */
export function setChunkLoader(load: typeof loader): void {
  loader = load;
}

/** The ids of the client components a flight payload renders, in order. */
export function clientIdsIn(payload: string): string[] {
  const ids: string[] = [];
  const row = /(?:^|\n)[0-9a-f]+:I\["([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = row.exec(payload)) !== null && ids.length < PER_PAGE) {
    if (!ids.includes(match[1]!)) ids.push(match[1]!);
  }

  return ids;
}

const idle: (fn: () => void) => void =
  typeof requestIdleCallback === "function"
    ? (fn) => void requestIdleCallback(fn, { timeout: 2000 })
    : (fn) => void setTimeout(fn, 1);

/** Load the chunks a payload's client components live in, at idle. Returns how many were asked for. */
export function preloadChunks(payload: string): number {
  if (!loader || typeof document === "undefined") return 0;
  if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return 0;

  const fresh = clientIdsIn(payload).filter((id) => !asked.has(id));
  const room = PER_DOCUMENT - asked.size;
  const wanted = fresh.slice(0, Math.max(0, room));

  for (const id of wanted) asked.add(id);

  if (wanted.length > 0) {
    const load = loader;

    idle(() => {
      for (const id of wanted) {
        // A chunk that fails to load here is asked for again when the page
        // renders, and fails there where it is handled.
        void load(id)?.catch(() => {});
      }
    });
  }

  return wanted.length;
}
