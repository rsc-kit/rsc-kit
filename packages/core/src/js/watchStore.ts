// The tab's side of tags: what the page is showing, watched on one stream.
//
// Every section or page rendered with tags registers them here, with the
// version each was at and its signature. The union is what the stream
// watches; a version that moved refreshes exactly the regions holding its
// tag, through the same refresh() a page calls itself. One stream per tab
// however many regions, reopened only when the set of tags changes, closed
// while the tab is hidden and caught up when it is seen again.

import { refresh } from "./router";

/** A region's tags, as the server rendered them: version at render and signature. */
export interface Registration {
  target: string;
  tags: Record<string, [version: number, signature: string]>;
}

const WATCH_PATH = "/_rsc/watch";

const registrations = new Set<Registration>();

let source: EventSource | null = null;
let openedWith = "";
let settle: ReturnType<typeof setTimeout> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let listening = false;

/** Register a rendered region's tags; the returned function forgets them. */
export function register(entry: Registration): () => void {
  registrations.add(entry);
  schedule();

  return () => {
    registrations.delete(entry);
    schedule();
  };
}

function listen(): void {
  if (listening || typeof document === "undefined") return;

  listening = true;
  document.addEventListener("visibilitychange", () =>
    document.hidden ? close() : schedule(),
  );
  window.addEventListener("online", schedule);
}

/** Many regions register in one commit; one reconcile serves them all. */
function schedule(): void {
  listen();
  clearTimeout(settle);
  settle = setTimeout(reconcile, 20);
}

/** Every tag any region holds, at the lowest version held - the one furthest behind decides. */
function union(): [string, number, string][] {
  const held = new Map<string, [number, string]>();

  for (const { tags } of registrations) {
    for (const [tag, [version, signature]] of Object.entries(tags)) {
      const seen = held.get(tag);

      if (!seen || version < seen[0]) held.set(tag, [version, signature]);
    }
  }

  return [...held]
    .map(([tag, [version, signature]]): [string, number, string] => [
      tag,
      version,
      signature,
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function reconcile(): void {
  const entries = union();

  if (
    entries.length === 0 ||
    (typeof document !== "undefined" && document.hidden) ||
    typeof EventSource === "undefined"
  ) {
    close();

    return;
  }

  const key = JSON.stringify(entries);

  // Something changed: a region came or went, or one re-rendered at a new
  // version. Either way the set is new, and a failed stream gets a fresh try.
  if (key !== openedWith) failures = 0;
  if (source && key === openedWith) return;

  open(key, entries);
}

function open(key: string, entries: [string, number, string][]): void {
  close();
  openedWith = key;

  const stream = new EventSource(
    WATCH_PATH + "?w=" + encodeURIComponent(JSON.stringify(entries)),
  );

  source = stream;

  stream.onopen = () => {
    failures = 0;
  };

  stream.onmessage = (event: MessageEvent) => {
    let moved: { tag?: unknown; version?: unknown };

    try {
      moved = JSON.parse(event.data as string) as {
        tag?: unknown;
        version?: unknown;
      };
    } catch {
      return;
    }

    if (typeof moved.tag === "string" && typeof moved.version === "number")
      apply(moved.tag, moved.version);
  };

  stream.onerror = () => {
    // CONNECTING: the browser is retrying a dropped connection itself. CLOSED:
    // an error answer - a 403 for tags signed by another deploy, a 502 - and
    // only a new stream comes back. Three in a row and the page is left alone
    // until something re-renders and registers afresh.
    if (stream.readyState !== EventSource.CLOSED) return;

    stream.close();
    if (source === stream) source = null;
    if (++failures > 3) return;

    retry = setTimeout(
      () => open(openedWith, entries),
      Math.min(30_000, 1000 * 2 ** (failures - 1)),
    );
  };
}

function close(): void {
  clearTimeout(retry);
  source?.close();
  source = null;
  openedWith = "";
}

let pending: Set<string> | null = null;

/** A version moved: every region holding the tag at another version refreshes, once per tick. */
function apply(tag: string, version: number): void {
  for (const entry of registrations) {
    const held = entry.tags[tag];

    if (!held || held[0] === version) continue;

    held[0] = version;
    (pending ??= new Set()).add(entry.target);
  }

  if (!pending) return;

  queueMicrotask(() => {
    const targets = pending;

    pending = null;
    if (!targets) return;

    // The page re-renders its sections with it, so refreshing both is twice.
    const run = targets.has("page") ? ["page"] : [...targets];

    for (const target of run) void refresh(target as never).catch(() => {});
  });
}

/** For tests. */
export function resetWatch(): void {
  registrations.clear();
  close();
  failures = 0;
  pending = null;
}
