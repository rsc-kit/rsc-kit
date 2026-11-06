/**
 * Telling a CDN that kept pages changed.
 *
 * A `revalidate` page goes out with `Cache-Tag`, and a CDN that purges by tag
 * can drop it the moment one of those tags changes, rather than waiting out
 * `s-maxage`. What calls the purge is the app's: every CDN has its own API, so
 * the engine has one hook, `installPurge()`, and `changed(tag)` calls it with
 * the names that changed - after the answer has gone, through `after()`, so a
 * slow CDN never holds up the action that made the change.
 *
 * Homeport is the one installed for you: with `HOMEPORT_PURGE_URL` set, the
 * hook is `homeportPurge()` unless the app installed another.
 *
 * A Laravel or Go backend changes its names itself (`Rsc::changed()`,
 * `rsckit.Changed()`), and the engine never hears of it, so each backend
 * purges for its own changes. This hook covers `changed()` called here.
 */

// Not imported: @rsc-kit/core/changed reaches this file and a client component
// may import that, so request.ts - server-only - is found through the global
// it sets when the server loads it. Without it, there is no request to wait
// for, and a purge goes out at once.
type AfterHooks = { after: (work: () => unknown) => void; requestKey: () => object | null };

function hooks(): AfterHooks {
  return (
    ((globalThis as Record<symbol, unknown>)[Symbol.for("rsc-kit.after")] as AfterHooks | undefined) ?? {
      after: (work) => void Promise.resolve().then(work),
      requestKey: () => null,
    }
  );
}

/** What a purge drops: pages carrying any of these tags, pages at these paths, or everything. */
export interface Purge {
  tags?: readonly string[];
  paths?: readonly string[];
  all?: boolean;
}

/** Sends a purge to a CDN. A rejection is logged; it never fails the change. */
export type Purger = (purge: Purge) => Promise<void> | void;

// On the global, like the cache store: an app installs through its own copy
// of the package, and the engine's copy is the one that calls it.
const PURGER = Symbol.for("rsc-kit.purger");
const globals = globalThis as unknown as Record<symbol, Purger | null | undefined>;

/** Install the app's purge. `null` takes it out, and Homeport's default with it. */
export function installPurge(purger: Purger | null): void {
  globals[PURGER] = purger;
}

/** The purge in use: the app's, else Homeport's when its url is set, else none. */
export function installedPurge(): Purger | null {
  const installed = globals[PURGER];

  if (installed !== undefined) return installed;

  const url = homeportPurgeUrl();

  return url ? homeportPurge({ url }) : null;
}

function homeportPurgeUrl(): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.HOMEPORT_PURGE_URL || undefined;
}

// The names an action changed go out as one purge when its answer has gone:
// three changed() calls send one request, not three. Gathered per request,
// so a request whose after() work never ran cannot hold back another's.
const pendingFor = new WeakMap<object, Set<string>>();

/**
 * @internal For changed(): purge these tags once the answer has gone, or at
 * once outside a request. Does nothing when no purge is installed.
 */
export function purgeLater(tags: readonly string[]): void {
  if (tags.length === 0 || !installedPurge()) return;

  const { after, requestKey } = hooks();
  const key = requestKey();

  if (!key) {
    after(() => purge({ tags }));

    return;
  }

  let pending = pendingFor.get(key);

  if (pending) {
    for (const tag of tags) pending.add(tag);

    return;
  }

  pending = new Set(tags);
  pendingFor.set(key, pending);

  const gathered = pending;

  after(() => {
    pendingFor.delete(key);

    return purge({ tags: [...gathered] });
  });
}

let warnedPurge = false;

/**
 * Send a purge now, through the installed purge. For an app's own use - a
 * deploy step, a webhook - as well as changed()'s. Never throws: the change
 * it follows is already made, and a CDN that missed it still drops the copy
 * at `s-maxage`. The first failure is logged.
 */
export async function purge(what: Purge): Promise<void> {
  const purger = installedPurge();

  if (!purger) return;

  try {
    await purger(what);
  } catch (error) {
    if (!warnedPurge) {
      warnedPurge = true;
      console.warn(
        "[rsc-kit] purging the CDN failed; its copy is dropped at s-maxage instead: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}

/** Homeport takes at most this many tags and paths, together, per call. */
export const HOMEPORT_PURGE_LIMIT = 100;

/** The longest tag and path Homeport takes, in bytes. */
const HOMEPORT_TAG_BYTES = 1024;
const HOMEPORT_PATH_BYTES = 2048;

const bytes = new TextEncoder();

export interface HomeportPurgeOptions {
  /** Where to post. Default `HOMEPORT_PURGE_URL`, which Homeport sets. */
  url?: string;
  /** For tests. */
  fetch?: typeof fetch;
}

/**
 * Homeport's purge: `POST {tags, paths, all}` to the url Homeport gives the
 * app, no token - it is reachable only from inside the app's own network.
 * Split into calls of 100 tags and paths together. A tag or path too long for
 * it is left out: one would cost the whole call, and the edge keeps no page
 * with a tag it could not purge. Only a 202 is accepted. A 429 is tried once
 * more after its `Retry-After` (at most five seconds); anything else rejects.
 */
export function homeportPurge(options: HomeportPurgeOptions = {}): Purger {
  return async (what) => {
    const url = options.url ?? homeportPurgeUrl();

    if (!url) throw new Error("homeportPurge() has no url: HOMEPORT_PURGE_URL is not set.");

    const send = options.fetch ?? fetch;
    const tags = (what.tags ?? []).filter((tag) => bytes.encode(tag).length <= HOMEPORT_TAG_BYTES);
    const paths = (what.paths ?? []).filter((path) => bytes.encode(path).length <= HOMEPORT_PATH_BYTES);
    const bodies: Purge[] = [];

    if (what.all) bodies.push({ all: true });

    while (tags.length > 0 || paths.length > 0) {
      const body: Purge = {};
      const someTags = tags.splice(0, HOMEPORT_PURGE_LIMIT);
      const somePaths = paths.splice(0, HOMEPORT_PURGE_LIMIT - someTags.length);

      if (someTags.length > 0) body.tags = someTags;
      if (somePaths.length > 0) body.paths = somePaths;
      bodies.push(body);
    }

    for (const body of bodies) {
      await post(send, url, body);
    }
  };
}

async function post(send: typeof fetch, url: string, body: Purge, retried = false): Promise<void> {
  const response = await send(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  await response.body?.cancel();

  if (response.status === 202) return;

  if (response.status === 429 && !retried) {
    const seconds = Math.min(Number(response.headers.get("Retry-After")) || 1, 5);

    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

    return post(send, url, body, true);
  }

  throw new Error(`Homeport answered ${response.status} to a purge of ${JSON.stringify(body)}.`);
}
