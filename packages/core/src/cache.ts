// Asking the same question twice in one request.
//
//   import { cache } from '@rsc-kit/core/cache'
//
//   export const currentUser = cache(async () => db.user(await sessionId()))
//
// A guard checks who you are; the layout wants their name; the page wants their
// permissions. Three calls, one request, one answer — without threading the
// result through props that only exist to carry it.
//
// This is the same shape as React's cache(), and deliberately not React's: the
// engine's own boundaries are not React's. A guard runs before any component
// does, which is exactly where the duplication starts, and React has no scope
// open there.
//
// Scoped to the request, so two in flight cannot see each other's answers. The
// scope is opened by whoever owns the request — the host, the worker, or the
// prerenderer — and everything below it shares one store.

import { versionSource } from "./changed.js";
import { noteAwaiter, withHelper, withoutRequest } from "./request.js";
import { resolveScope } from "./revalidate.js";

/** One request's memo table. */
type Store = Map<unknown, ArgNode>;

/**
 * Arguments keyed the way React keys them: a tree, one level per argument.
 *
 * Primitives compare by value and objects by identity, which falls out of
 * using a Map for the first and a WeakMap for the second. Serialising the
 * arguments instead would make `f({ a: 1 })` and `f({ a: 1 })` the same call —
 * which they are not, if the object is mutable.
 */
interface ArgNode {
  /** The answer for the argument list that ends here. */
  result?: { value: unknown };
  byValue?: Map<unknown, ArgNode>;
  byIdentity?: WeakMap<object, ArgNode>;
}

const SCOPE = Symbol.for("@rsc-kit/core.cache-scope");

const globals = globalThis as Record<symbol | string, unknown>;

let ready: Promise<void> | null = null;

interface Scope {
  getStore(): Store | undefined;
  run<T>(store: Store, fn: () => T): T;
}

function scope(): Scope | null {
  return (globals[SCOPE] as Scope | undefined) ?? null;
}

function isObject(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

/** Walk to the node for this argument list, creating it as we go. */
function nodeFor(root: ArgNode, args: unknown[]): ArgNode {
  let node = root;

  for (const arg of args) {
    if (isObject(arg)) {
      node.byIdentity ??= new WeakMap();

      let next = node.byIdentity.get(arg);

      if (!next) {
        next = {};
        node.byIdentity.set(arg, next);
      }

      node = next;
    } else {
      node.byValue ??= new Map();

      let next = node.byValue.get(arg);

      if (!next) {
        next = {};
        node.byValue.set(arg, next);
      }

      node = next;
    }
  }

  return node;
}

/**
 * Memoise a function for the length of one request - or, given a key and a
 * lifetime, across requests too.
 *
 * The *promise* is cached, not the value, so callers that arrive while the
 * first is still in flight wait on it rather than starting a second. A
 * rejection is cached too: within one request the answer to a question does
 * not change because you asked again.
 *
 * Outside a request this calls straight through. Nothing is stored, nothing
 * leaks between requests, and shared code does not have to know which side of
 * the boundary it is on — the same reason revalidate() is a no-op outside an
 * action.
 *
 * With options, the answer is also kept in the cache store (see
 * {@link installCacheStore}) for `revalidate` seconds, shared by every
 * request, and by every instance when the store is shared:
 *
 *     export const findPage = cache(
 *       async (slug: string) => db.pages.find(slug),
 *       { key: 'pages.find', revalidate: 3600, tags: ['pages'] },
 *     )
 *
 *     // wherever pages are saved
 *     await changed('pages')    // the next findPage() asks the database again
 *
 * Arguments and answer must be JSON. The function runs as nobody - no
 * cookies(), no headers(), no session on a backend call - because its
 * answer is handed to every visitor; a read throws instead of leaking.
 */
export function cache<A extends unknown[], R>(
  fn: (...args: A) => R,
  options?: AcrossRequests<A>,
): (...args: A) => R {
  const run = options ? (across(fn as never, options) as unknown as (...args: A) => R) : fn;

  return (...args: A): R => {
    const store = scope()?.getStore();

    if (!store) return run(...args);

    let root = store.get(fn);

    if (!root) {
      root = {};
      store.set(fn, root);
    }

    const node = nodeFor(root, args);

    // Who asked, every time: the body runs once, and a read it makes can
    // then name every component that waited on it, not only the first.
    noteAwaiter(fn);

    if (node.result) return node.result.value as R;

    const value = withHelper(fn, () => run(...args));

    node.result = { value };

    return value;
  };
}

// ── Across requests ──────────────────────────────────────────────────────────
//
// Where answers are kept is the app's choice, as with the versions behind
// changed(): memory by default, or anything with a get and a set - Redis,
// Workers KV, a table. The store keeps strings and nothing else; the engine
// owns the key, the lifetime and the invalidation.
//
// Invalidation is a version, not a delete. A key carries the current version
// of each of its tags, read from the same source changed() bumps, so after
// changed('pages') the next ask builds a different key and misses. The old
// entry is never read again and expires on its own. That is why a store needs
// no delete, no scan and no purge - and why a change made on one instance is
// seen by the next ask on every other, when the versions are shared.

/** How a function's answers are kept between requests. */
export interface AcrossRequests<A extends unknown[] = unknown[]> {
  /**
   * The function's name in the store, the same on every instance: a function
   * has no identity outside this process. Two functions must not share one.
   */
  key: string;
  /** Seconds an answer is kept before it is asked again. */
  revalidate: number;
  /**
   * Names whose change makes every answer stale at once: `changed('pages')`.
   * The same names `refreshOn` and `changed()` use, so a change that refreshes
   * open tabs also misses here. Given the arguments, for a tag per record.
   */
  tags?: string[] | ((...args: A) => string[]);
}

/**
 * Where answers kept across requests live. Strings in, strings out.
 *
 *     // Redis
 *     installCacheStore({
 *       get: (key) => redis.get(key),
 *       set: (key, value, ttl) => redis.set(key, value, 'EX', ttl),
 *     })
 *
 *     // Workers KV (60 seconds is KV's shortest expiry)
 *     installCacheStore({
 *       get: (key) => env.CACHE.get(key),
 *       set: (key, value, ttl) => env.CACHE.put(key, value, { expirationTtl: Math.max(60, ttl) }),
 *     })
 *
 * A store may forget anything at any time, and may keep it past `ttl`: the
 * engine checks an answer's age itself.
 */
export interface CacheStore {
  get(key: string): Promise<string | null | undefined> | string | null | undefined;
  set(key: string, value: string, ttl: number): Promise<unknown> | unknown;
}

const STORE = Symbol.for("@rsc-kit/core.cache-store");
const LOCAL_STORE = Symbol.for("@rsc-kit/core.cache-store-local");
const BUILD = Symbol.for("@rsc-kit/core.cache-build");
const IN_FLIGHT = Symbol.for("@rsc-kit/core.cache-in-flight");

/**
 * Answers kept in this process, the most recently used `max` of them (1,000
 * by default). The store without one installed: fast, and one copy per
 * instance, so a change on another instance is seen when the answer expires.
 */
export function memoryCacheStore(options: { max?: number } = {}): CacheStore {
  const max = options.max ?? 1000;
  const entries = new Map<string, { value: string; until: number }>();

  return {
    get(key) {
      const entry = entries.get(key);

      if (!entry) return undefined;

      entries.delete(key);

      if (entry.until <= Date.now()) return undefined;

      // Re-inserted, so the Map's order is least recently used first.
      entries.set(key, entry);

      return entry.value;
    },
    set(key, value, ttl) {
      entries.delete(key);
      entries.set(key, { value, until: Date.now() + ttl * 1000 });

      while (entries.size > max) entries.delete(entries.keys().next().value!);
    },
  };
}

/**
 * Choose where answers are kept across requests: a store, or a function that
 * makes one on first use (so the build, which loads the app without its
 * settings, never connects). `null` goes back to memory.
 */
export function installCacheStore(
  store: CacheStore | (() => CacheStore) | null,
): void {
  globals[STORE] = store;
}

/** The store in use: the app's, else this process's memory. */
export function cacheStore(): CacheStore {
  if (typeof globals[STORE] === "function")
    globals[STORE] = (globals[STORE] as () => CacheStore)();

  return (
    (globals[STORE] as CacheStore | null | undefined) ??
    ((globals[LOCAL_STORE] as CacheStore | undefined) ??= memoryCacheStore())
  );
}

/**
 * The build answers are kept for. Set by the host once it knows its own, so
 * a deploy never reads answers a previous build kept - their shape may have
 * changed with the code. Not for apps.
 */
export function setCacheBuild(build: string | null | undefined): void {
  globals[BUILD] = build ?? "";
}

let warnedStore = false;

/** A store that fails is a slower page, not a broken one: said once, then asked around. */
function storeFailed(error: unknown): void {
  if (warnedStore) return;
  warnedStore = true;
  console.warn(
    "[rsc-kit] the cache store failed, so answers are being worked out each time instead:",
    error,
  );
}

interface Kept {
  /** The answer. Absent when it was undefined, which JSON cannot spell. */
  v?: unknown;
  /** When it was worked out, in ms. */
  at: number;
}

function across<A extends unknown[], R>(
  fn: (...args: A) => Promise<R> | R,
  options: AcrossRequests<A>,
): (...args: A) => Promise<R> {
  if (!options.key) throw new Error("[rsc-kit] cache() across requests needs a key");
  if (!(options.revalidate > 0))
    throw new Error(`[rsc-kit] cache() ${options.key}: revalidate is seconds, above 0`);

  // Whole seconds for the store, which may round anyway; the age is checked exactly.
  const ttl = Math.ceil(options.revalidate);

  return async (...args: A): Promise<R> => {
    const tags =
      typeof options.tags === "function" ? options.tags(...args) : options.tags ?? [];
    const versions = tags.length
      ? await versionSource().changed(Object.fromEntries(tags.map((tag) => [tag, 0])), 0)
      : {};
    const key = [
      "rsc-cache",
      (globals[BUILD] as string | undefined) ?? "",
      options.key,
      JSON.stringify(args),
      tags.map((tag) => `${tag}@${versions[tag] ?? 0}`).join(","),
    ].join("|");

    // One ask per key at a time in this process: a burst of visitors to a
    // page nobody has asked for yet starts one lookup, not one each.
    const inFlight = ((globals[IN_FLIGHT] as Map<string, Promise<unknown>> | undefined) ??=
      new Map());
    const pending = inFlight.get(key);

    if (pending) return pending as Promise<R>;

    const work = (async (): Promise<R> => {
      const store = cacheStore();
      let raw: string | null | undefined;

      try {
        raw = await store.get(key);
      } catch (error) {
        storeFailed(error);
      }

      if (raw) {
        const kept = JSON.parse(raw) as Kept;

        if (Date.now() - kept.at < options.revalidate * 1000) return kept.v as R;
      }

      const value = await withoutRequest(() => fn(...args));
      const kept: Kept = { at: Date.now() };

      if (value !== undefined) kept.v = value;

      // Every caller gets what the store would give back - a miss as well as
      // a hit - so a Date is a string the first time too, not only after.
      const text = JSON.stringify(kept);

      try {
        await store.set(key, text, ttl);
      } catch (error) {
        storeFailed(error);
      }

      return (JSON.parse(text) as Kept).v as R;
    })();

    inFlight.set(key, work);

    try {
      return await work;
    } finally {
      inFlight.delete(key);
    }
  };
}

/** Whether anything is listening, for code that wants to know. */
export function isCaching(): boolean {
  return scope()?.getStore() !== undefined;
}

/**
 * Run one request with a memo table of its own.
 *
 * Opened by whoever owns the request. Nesting is harmless and does not create a
 * second table — an inner call reuses the one already open, so a host that
 * wraps and an engine that also wraps do not end up with two.
 */
export async function withCache<T>(run: () => Promise<T>): Promise<T> {
  if (!globals[SCOPE]) {
    ready ??= resolveScope().then((resolved) => {
      globals[SCOPE] ??= resolved as unknown as Scope;
    });

    await ready;
  }

  const existing = scope()!.getStore();

  if (existing) return await run();

  return await scope()!.run(new Map(), run);
}

/**
 * Forget every answer this request has cached so far.
 *
 * For the render that follows a mutation. An action's request memoises what
 * the middleware and the action read before the row was changed, and a
 * revalidation rendered in the same request would read those answers back:
 * a port renamed its agent and the sidebar the action re-rendered still
 * said the old name, while the row was updated. What was true before the
 * write is not a memo of what is true after it.
 */
export function forgetCached(): void {
  scope()?.getStore()?.clear();
}
