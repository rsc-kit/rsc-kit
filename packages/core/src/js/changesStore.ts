// The tab's side of live sections: what the page is showing, on one stream.
//
// Every section or page rendered with `live` registers its names here, with
// the version each was at and its signature. The union is what the stream
// watches; a version that moved refreshes exactly the regions live on that
// name, through the same refresh() a page calls itself. One stream per tab
// however many regions, reopened only when the set of names changes, closed
// while the tab is hidden and caught up when it is seen again.

import { refresh, refreshOnChange } from "./router";

/** The names a region is live on, as the server rendered them: version at render and signature. */
export interface Registration {
  target: string;
  names: Record<string, [version: number, signature: string]>;
}

const CHANGES_PATH = "/_rsc/changes";

const registrations = new Set<Registration>();

let source: EventSource | null = null;
let openedWith = "";
let settle: ReturnType<typeof setTimeout> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let listening = false;

/** Register what a rendered region is live on; the returned function forgets it. */
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
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return schedule();

    // Hidden tabs do not hold a connection. Nothing is missed: seen again,
    // the stream reopens at the versions this tab holds and every name that
    // moved meanwhile is reported at once.
    if (source)
      note(
        "refreshOn paused: tab hidden. It catches up when the tab is shown.",
      );
    close();
  });
  window.addEventListener("online", schedule);
}

/** Many regions register in one commit; one reconcile serves them all. */
function schedule(): void {
  listen();
  clearTimeout(settle);
  settle = setTimeout(reconcile, 20);
}

/** Every name any region is live on, at the lowest version held - the one furthest behind decides. */
function union(): [string, number, string][] {
  const held = new Map<string, [number, string]>();

  for (const { names } of registrations) {
    for (const [name, [version, signature]] of Object.entries(names)) {
      const seen = held.get(name);

      if (!seen || version < seen[0]) held.set(name, [version, signature]);
    }
  }

  return [...held]
    .map(([name, [version, signature]]): [string, number, string] => [
      name,
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

  if (import.meta.env?.DEV) {
    const lines = [...registrations].map(
      ({ target, names }) =>
        `  ${target}: ${Object.entries(names)
          .map(([name, [version]]) => `${name} @${version}`)
          .join(", ")}`,
    );

    note(`refreshOn watching, by region:\n${lines.join("\n")}`);
  }

  open(key, entries);
}

/**
 * Development only: what the page refreshes on, and why it stopped. A region
 * that declared refreshOn but is missing from the list rendered no names -
 * the server said why, once, in its own log.
 */
function note(message: string): void {
  if (import.meta.env?.DEV) console.info("[rsc-kit] " + message);
}

function open(key: string, entries: [string, number, string][]): void {
  close();
  openedWith = key;

  const stream = new EventSource(
    CHANGES_PATH + "?w=" + encodeURIComponent(JSON.stringify(entries)),
  );

  source = stream;

  stream.onopen = () => {
    failures = 0;
  };

  stream.onmessage = (event: MessageEvent) => {
    let moved: { name?: unknown; version?: unknown };

    try {
      moved = JSON.parse(event.data as string) as {
        name?: unknown;
        version?: unknown;
      };
    } catch {
      return;
    }

    if (typeof moved.name === "string" && typeof moved.version === "number")
      apply(moved.name, moved.version);
  };

  stream.onerror = () => {
    // CONNECTING: the browser is retrying a dropped connection itself. CLOSED:
    // an error answer - a 403 for names signed by another deploy, a 502 - and
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

/** Regions to refresh this tick, each with the changes that moved it: `stock@5`. */
let pending: Map<string, Set<string>> | null = null;

/** A version moved: every region on the name at another version refreshes, once per tick. */
function apply(name: string, version: number): void {
  for (const entry of registrations) {
    const held = entry.names[name];

    if (!held || held[0] === version) continue;

    held[0] = version;

    const changes =
      (pending ??= new Map()).get(entry.target) ?? new Set<string>();

    changes.add(name + "@" + version);
    pending.set(entry.target, changes);
  }

  if (!pending) return;

  queueMicrotask(() => {
    const targets = pending;

    pending = null;
    if (!targets) return;

    // The page re-renders its sections with it, so refreshing both is twice.
    if (targets.has("page")) {
      void refresh("page").catch(() => {});

      return;
    }

    // Saying which change asked lets every tab asking about the same one
    // share a single render of a shared section.
    for (const [target, changes] of targets) {
      void refreshOnChange(target, [...changes].sort().join(",")).catch(
        () => {},
      );
    }
  });
}

/** For tests. */
export function resetChanges(): void {
  registrations.clear();
  close();
  failures = 0;
  pending = null;
}
