/**
 * What each segment boundary is showing, and what it is keeping alive behind it.
 *
 * A navigation replaces one segment. Keeping the previous one mounted — hidden,
 * not unmounted — is what lets going back restore it with its client state:
 * the half-typed form, the open disclosure, the scrolled list. Unmounting
 * throws all of that away, which is what replacing the root used to do.
 *
 * Entries are keyed by page (the URL, or its intercept variant), so a boundary
 * can hold several and reveal one. Empty is meaningful: a boundary with nothing
 * stored renders the children the server gave it.
 *
 * A store rather than state, and not a preference — three things rule state out.
 * A boundary is inserted between every layout level, so there are several and a
 * navigation targets one by depth; they are separated by server components, so
 * no setter can be threaded down to them, because a function does not cross
 * that boundary; and navigate.ts is a plain module with no component instance
 * to call one on. Addressing a component you hold no reference to is what an
 * external store is for.
 *
 * Underneath it is the wire protocol. A partial navigation sends only the
 * segment that changed — see the X-RSC-Segments headers — so there is nothing
 * for a root to re-render with even if it held the state. Next.js keeps its
 * router in useState and derives every segment from it; that is the same trade
 * in the other direction.
 *
 * What it costs: React pins an external store's updates to synchronous
 * priority, because a store cannot be safely time-sliced. Synchronous is never
 * a transition, and anything that only runs for one — React's <ViewTransition>
 * among them — never ran for a navigation.
 *
 * Which is why SegmentBoundary does not read this with useSyncExternalStore
 * any more. The store still does the addressing, which is the part only it can
 * do; the boundary copies into state, so the render is a transition. See the
 * view transitions guide.
 */

type Tree = unknown;
type Listener = () => void;

interface Entry {
  key: string;
  tree: Tree;
  /**
   * When this tree arrived, so a link can decide whether it is still worth
   * revealing. The back button never asks — it means "the page I was on",
   * however long ago that was.
   */
  at: number;
}

/**
 * Immutable: useSyncExternalStore compares snapshots by identity, so a new
 * object per read reads as "changed every render" and loops forever. Every
 * mutation replaces this wholesale; nothing edits one in place.
 */
interface DepthState {
  readonly entries: readonly Entry[];
  readonly activeKey: string;
  /** Most recently shown last; eviction takes from the front. */
  readonly order: readonly string[];
}

/** Pages kept alive per boundary. Four covers ordinary back-and-forth. */
export const RETENTION = 4;

const depths = new Map<number, DepthState>();
const listeners = new Map<number, Set<Listener>>();

function notify(depth: number): void {
  for (const listener of listeners.get(depth) ?? []) listener();
}

export function subscribeToSegment(
  depth: number,
  listener: Listener,
): () => void {
  let set = listeners.get(depth);

  if (!set) {
    set = new Set();
    listeners.set(depth, set);
  }

  set.add(listener);

  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(depth);
  };
}

/** Everything a boundary at this depth needs to render, or null for "use children". */
export function getSegmentState(depth: number): DepthState | null {
  return depths.get(depth) ?? null;
}

/** Apply the retention window to a candidate state. */
function retain(
  entries: readonly Entry[],
  order: readonly string[],
  activeKey: string,
): DepthState {
  const kept = order.slice(-RETENTION);

  return {
    entries: entries.filter((entry) => kept.includes(entry.key)),
    order: kept,
    activeKey,
  };
}

function put(depth: number, key: string, tree: Tree): void {
  const state = depths.get(depth);
  const entries = [
    ...(state?.entries ?? []).filter((entry) => entry.key !== key),
    { key, tree, at: Date.now() },
  ];
  const order = [...(state?.order ?? []).filter((k) => k !== key), key];

  depths.set(depth, retain(entries, order, key));
}

/**
 * Show `tree` at `depth` for `key`, retaining what was there.
 *
 * Deeper segments belonged to the page being replaced; leaving them would
 * render the previous page inside the new one.
 */
export function setSegment(depth: number, key: string, tree: Tree): void {
  put(depth, key, tree);

  const stale = [...depths.keys()].filter((d) => d > depth);
  for (const d of stale) depths.delete(d);

  notify(depth);
  for (const d of stale) notify(d);
}

/**
 * Record the children the server rendered, so the page you arrived on can be
 * returned to later. Never changes what is showing.
 */
export function seedSegment(depth: number, key: string, tree: Tree): void {
  const state = depths.get(depth);

  if (state?.entries.some((entry) => entry.key === key)) return;

  if (!state) {
    put(depth, key, tree);
    notify(depth);

    return;
  }

  // Older than whatever is showing, so it goes to the front of the eviction
  // order — and crucially does not become the active page.
  depths.set(
    depth,
    retain(
      [...state.entries, { key, tree, at: Date.now() }],
      [key, ...state.order.filter((k) => k !== key)],
      state.activeKey,
    ),
  );

  notify(depth);
}

/**
 * Reveal a page the boundaries are still holding, without asking the server.
 *
 * Restoring is anchored on the deepest boundary that can show the page. Deeper
 * ones than that belonged to the page being left — a section with its own
 * layout adds a boundary the page you are going back to never had — so they
 * are dropped, exactly as setSegment drops them. Requiring every boundary to
 * hold the key instead made any such page refuse to restore.
 *
 * Shallower boundaries need no key of their own: their trees contain the
 * deeper boundary, so they delegate to whatever it is showing. One that does
 * hold the key is switched to it, since that is a real change at its level.
 */
/**
 * Reveal a page still being held, if it is worth revealing.
 *
 * `maxAge` is what a link passes and the back button does not. Going back is
 * unambiguous — it names a moment, and the page from that moment is the right
 * answer however old. A link says "go here", and answering it with a tree from
 * twenty minutes ago is stale data presented as fresh, which is the objection
 * this design started with. Recent enough, and it is the same page you were
 * just on, with the form you were filling in still filled in.
 */
export function restoreSegments(key: string, maxAge?: number): boolean {
  const holding = [...depths.keys()].filter((d) =>
    depths.get(d)!.entries.some((entry) => entry.key === key),
  );

  if (holding.length === 0) return false;

  if (maxAge !== undefined) {
    const ages = holding.flatMap((d) =>
      depths
        .get(d)!
        .entries.filter((entry) => entry.key === key)
        .map((entry) => entry.at),
    );

    // The oldest layer decides: revealing a fresh page under a stale layout
    // would be a chain nobody rendered together.
    // >= rather than >, so a window of 0 means never rather than "only within
    // the same millisecond".
    if (Date.now() - Math.min(...ages) >= maxAge) return false;
  }

  const anchor = Math.max(...holding);

  for (const d of [...depths.keys()].filter((d) => d > anchor)) {
    depths.delete(d);
    notify(d);
  }

  for (const d of holding) {
    const state = depths.get(d)!;

    depths.set(
      d,
      retain(
        state.entries,
        [...state.order.filter((k) => k !== key), key],
        key,
      ),
    );
    notify(d);
  }

  return true;
}

/**
 * Drop everything, so boundaries fall back to their server-given children.
 *
 * A deployment invalidates them all: a segment from the previous build has no
 * claim on being correct for this one.
 */
export function clearSegments(): void {
  const all = [...depths.keys()];
  depths.clear();
  for (const depth of all) notify(depth);
}

/**
 * Whether a navigation has happened in this document.
 *
 * The first commit after hydration is the boundary taking over its
 * server-rendered children - the same page, re-keyed for retention. A view
 * transition for that commit fades the page into itself: the blank-then-
 * content a first load or a reload showed. Inertia transitions on visits and
 * never on load; so does this. The router notes the first navigation before
 * it updates a segment, and the boundary animates from then on.
 */
let navigated = false;

export function noteNavigation(): void {
  navigated = true;
}

export function navigatedOnce(): boolean {
  return navigated;
}
