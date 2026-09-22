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
  /**
   * Its place in the order things happened, for the question "was this
   * here before the mutation?" - which a clock answers wrongly for a seed
   * and a write in the same millisecond, and a test hit exactly that.
   */
  seq: number;
  /**
   * Rendered before the click, hidden, on the strength of a touch or a
   * settled hover - see prerenderSegment. Outside the retention window: it
   * is a guess, and a guess must not evict a page the visitor was on. One
   * per depth; the next guess replaces it, and a navigation to anything
   * else drops it.
   */
  speculative?: boolean;
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
/** A counter every entry takes a number from, in order. */
let tick = 0;
/** The number the last mutation took: everything held before it is wrong. */
let invalidatedAt = 0;
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
    entries: entries.filter((entry) => kept.includes(entry.key) || entry.speculative),
    order: kept,
    activeKey,
  };
}

function put(depth: number, key: string, tree: Tree): void {
  const state = depths.get(depth);
  const entries = [
    ...(state?.entries ?? []).filter((entry) => entry.key !== key),
    { key, tree, at: Date.now(), seq: ++tick },
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
  // A guess about another page was wrong; the one about this page, if there
  // was one, is replaced by put() below - with the same tree, when the
  // prerender and the navigation read the same decoded payload, which is
  // what makes the update a reveal rather than a render.
  dropSpeculative(depth, key);
  put(depth, key, tree);

  const stale = [...depths.keys()].filter((d) => d > depth);
  for (const d of stale) depths.delete(d);

  notify(depth);
  for (const d of stale) notify(d);
}

function dropSpeculative(depth: number, except?: string): void {
  const state = depths.get(depth);

  if (!state?.entries.some((entry) => entry.speculative && entry.key !== except)) return;

  depths.set(depth, {
    ...state,
    entries: state.entries.filter((entry) => !entry.speculative || entry.key === except),
  });
}

/**
 * Render a page hidden at `depth`, before any navigation to it.
 *
 * The click then finds the work done: setSegment with the same tree is a
 * bail-out for React - same element, same props - and the Activity flips
 * from hidden to visible. What was 87 ms of rendering on a phone, after
 * the tap, is paid before the finger lifts, at idle priority, yielding to
 * the scroll. Never changes what is showing, never counts against
 * retention, and a page already held needs nothing.
 */
export function prerenderSegment(depth: number, key: string, tree: Tree): void {
  const state = depths.get(depth);

  // Nothing at this depth yet: the boundary is still showing the server's
  // children, and it has no page key to keep them under. A guess would take
  // the store over with no active entry to show. seedSegment runs on mount,
  // so this is the gap between hydration and that effect; the click will
  // render.
  if (!state) return;

  if (state.entries.some((entry) => entry.key === key)) return;

  depths.set(depth, {
    ...state,
    entries: [
      ...state.entries.filter((entry) => !entry.speculative),
      { key, tree, at: Date.now(), seq: ++tick, speculative: true },
    ],
  });

  notify(depth);
}

/** Whether a page is rendered hidden at `depth`, ahead of a navigation to it. */
export function isPrerendered(depth: number, key: string): boolean {
  return depths.get(depth)?.entries.some((entry) => entry.key === key && entry.speculative) ?? false;
}

/**
 * Give the page on screen at `depth` a new tree, under the key it has.
 *
 * For revalidate("all"): the whole document rendered again, in place. The
 * root hands its layout the new tree, the layout hands its boundary new
 * children, and a boundary that holds state would otherwise keep showing
 * the store's tree and drop the new one on the floor - or, cleared first,
 * re-key its Activity to the current url and remount everything under it.
 * Neither. The entry that is showing takes the new tree and keeps its key,
 * so React reconciles the page in place, and the boundary below gets its
 * new children the same way.
 */
export function replaceActive(depth: number, tree: Tree): void {
  const state = depths.get(depth);

  if (!state) return;

  const active = state.entries.find((entry) => entry.key === state.activeKey);

  if (!active || active.tree === tree) return;

  // The tree changes; when the entry arrived does not. A layout's entry is
  // keyed by the page it was seeded with - "/" for a document loaded at
  // home - and stays active through every navigation below it. Stamped
  // with the re-render's time it read as held since the mutation, and a
  // tap on the brand link after "Add to cart" revealed it: the url went
  // to "/" and the product stayed, because the tree under that key was
  // now the product's document. See dropHidden and isHeld.
  depths.set(depth, {
    ...state,
    entries: state.entries.map((entry) => (entry === active ? { ...entry, tree } : entry)),
  });
  notify(depth);
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
      [...state.entries, { key, tree, at: Date.now(), seq: ++tick }],
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
 * Whether a link to `key` would be answered by revealing a held page.
 *
 * The question restoreSegments answers, asked without acting on it: a
 * prefetch of a page the boundaries still hold is a request for nothing -
 * a navigation would reveal it. The page just left is the usual case, one
 * wasted payload per navigation.
 */
export function isHeld(key: string, maxAge?: number): boolean {
  const ages = [...depths.values()].flatMap((state) =>
    state.entries.filter((entry) => entry.key === key && !entry.speculative && entry.seq > invalidatedAt).map((entry) => entry.at),
  );

  if (ages.length === 0) return false;
  if (maxAge === undefined) return true;

  return Date.now() - Math.min(...ages) < maxAge;
}

/**
 * Drop every page held behind the one on screen.
 *
 * After a mutation: a page kept for the back button holds the data from
 * before it, and revealing it would show a row that is gone, a name that
 * changed. The page on screen stays - it was re-rendered by the action, or
 * is about to be.
 */
export function dropHidden(): void {
  // And the ones that stay - the active entry at each depth - are from
  // before it too. A layout's entry is keyed by the page it was seeded
  // with, and revealing that key later shows the page inside it as it was
  // then. Nothing seeded before this moment is revealed again.
  invalidatedAt = ++tick;

  for (const [depth, state] of depths) {
    if (state.entries.length <= 1 && !state.entries.some((entry) => entry.speculative)) continue;

    depths.set(depth, {
      entries: state.entries.filter((entry) => entry.key === state.activeKey),
      order: state.order.filter((key) => key === state.activeKey),
      activeKey: state.activeKey,
    });
    notify(depth);
  }
}

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
  // A guess is not a held page: revealing it would be showing prefetched
  // data as the page the visitor was on. The navigation takes the
  // prerendered tree through setSegment instead, where it is a reveal too.
  // Nor is a page from before a mutation - see dropHidden.
  const holding = [...depths.keys()].filter((d) =>
    depths.get(d)!.entries.some((entry) => entry.key === key && !entry.speculative && entry.seq > invalidatedAt),
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
    dropSpeculative(d);

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
