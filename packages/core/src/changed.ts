/**
 * Names: a name for data a page depends on, so whatever changes it can say so
 * from anywhere - a webhook, a job, another visitor's action - and every open
 * tab showing it refreshes.
 *
 *     // a section says what it depends on
 *     export default section('repos', Repos, { refreshOn: ({ params }) => [`team:${params.team}:repos`] })
 *
 *     // and whatever changes it says so
 *     changed(`team:${team}:repos`)           // here, from a route.ts or an action
 *     rsckit.Changed(ctx, "team:1:repos")     // or the backend, from its webhook
 *     Rsc::changed("team:$team:repos");       // Laravel
 *
 * A name has a version: a number that moves whenever something says the name
 * changed. Nothing else - not what changed, not the data. A page learns the
 * versions at render; one stream per open tab watches them; when one moves,
 * the sections carrying that name ask for themselves again, the way refresh()
 * does. Data is never pushed, which is what keeps this working on a host that
 * cannot hold state: a version is a read.
 *
 * Where versions live is the source's business. Without a backend they are in
 * this process, which is one instance. With one, the backend keeps them - in
 * its cache or a table, shared by every instance it runs - and answers
 * `__rsc.changed`: given the versions a watcher holds, the ones that differ now.
 * A backend that can wait holds the call until one does; one that cannot
 * answers at once, and the watcher asks again on its interval. The protocol
 * is the same either way, and so is the page.
 */

import { KEEPALIVE_MS, frame } from "./events.js";
import { HEADER } from "./headers.js";

/** The reserved name a backend answers name versions on. */
export const CHANGED_FUNCTION = "__rsc.changed";

/** What `__rsc.changed` is asked. */
export interface ChangedQuery {
  /** The versions the asker holds. A name never changed is 0; -1 asks for every current version. */
  since: Record<string, number>;
  /** How long the backend may hold the call waiting for one to differ, in ms. It may answer at once. */
  wait?: number;
}

/** What `__rsc.changed` answers: the versions among `since` that differ now. */
export interface ChangedAnswer {
  versions: Record<string, number>;
}

/**
 * Where name versions are read from, and - when they live here - bumped.
 *
 * `changed` answers the versions among `since` that differ now, and may wait
 * up to `wait` ms for one to. Nothing else is required of it, which is why a
 * backend's cache, a table, this process's memory, or a pub/sub that answers
 * the moment a name moves all fit behind it.
 */
export interface VersionSource {
  changed(
    since: Record<string, number>,
    wait: number,
  ): Promise<Record<string, number>>;
  /** Say these names changed. Only a source that holds its own versions can. */
  bump(names: string[]): void | Promise<void>;
}

/** Versions kept in this process: the source without a backend, and the one tests use. */
export function memoryVersions(): VersionSource {
  const versions = new Map<string, number>();
  const waiters = new Set<() => void>();

  const differing = (since: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};

    for (const [name, held] of Object.entries(since)) {
      const current = versions.get(name) ?? 0;

      if (current !== held) out[name] = current;
    }

    return out;
  };

  return {
    async changed(since, wait) {
      const now = differing(since);

      if (Object.keys(now).length > 0 || wait <= 0) return now;

      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, wait);

        // A test or a build must not be held open by a watcher's wait.
        (timer as { unref?: () => void }).unref?.();
        waiters.add(done);
      });

      return differing(since);
    },
    bump(names) {
      for (const name of names) versions.set(name, (versions.get(name) ?? 0) + 1);
      for (const wake of [...waiters]) wake();
    },
  };
}

type HostFn = (name: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Versions kept by the backend, read through `__rsc.changed`.
 *
 * A backend that has not got the function - an adapter from before names, or
 * a host of plain rpc functions - is answered from this process instead,
 * found out on the first ask and remembered, so a page with names still works
 * on it: one instance, versions bumped by `changed()` here.
 */
export function backendVersions(call: HostFn): VersionSource {
  let local: VersionSource | null = null;

  // A backend's "no such function", or the test host's "no handler for".
  const unknown = (error: unknown): boolean =>
    /no host function named|has no handler for/i.test(
      error instanceof Error ? error.message : String(error),
    );

  return {
    async changed(since, wait) {
      if (local) return local.changed(since, wait);

      try {
        const answer = (await call(CHANGED_FUNCTION, {
          since,
          wait,
        } satisfies ChangedQuery)) as Partial<ChangedAnswer> | null;

        return answer?.versions ?? {};
      } catch (error) {
        if (!unknown(error)) throw error;

        local = memoryVersions();

        return local.changed(since, wait);
      }
    },
    bump(names) {
      if (local) return local.bump(names);

      throw new Error(
        "changed() bumps versions this process keeps, and a backend keeps these: say the name changed there - " +
          "rsckit.Changed(ctx, ...) in Go, Rsc::changed(...) in Laravel.",
      );
    },
  };
}

const SOURCE = Symbol.for("rsc-kit.version-source");
const globals = globalThis as Record<symbol, unknown>;

/** Install where versions are read from; `null` restores this process's own. */
export function installVersionSource(source: VersionSource | null): void {
  globals[SOURCE] = source;
}

/** The source in use: the backend's when a host is installed, this process's otherwise. */
export function versionSource(): VersionSource {
  return ((globals[SOURCE] as VersionSource | undefined) ??= memoryVersions());
}

/**
 * Say these names changed, so every open tab showing them refreshes.
 *
 *     export async function POST(request: Request) {   // a webhook, in a route.ts
 *       const { team } = await request.json()
 *       changed(`team:${team}:repos`)
 *       return new Response(null, { status: 204 })
 *     }
 *
 * For an app that keeps its versions here. With a backend the versions are
 * its, and so is the call: `rsckit.Changed`, `Rsc::changed`.
 */
export async function changed(...names: string[]): Promise<void> {
  await versionSource().bump(names);
}

// ── Tokens ───────────────────────────────────────────────────────────────────
//
// A tab may watch exactly the names its page was rendered with. Rather than
// remembering what each tab was given - state, which a Worker cannot keep
// between requests - every name goes to the client signed, and comes back
// with its signature. Verified, not looked up, so a watch request is
// stateless, and a browser cannot make up a name to watch.

let secret: string | null = null;
let keyed: Promise<CryptoKey> | null = null;
const signatures = new Map<string, Promise<string>>();

/**
 * The key names are signed with. Set from `RSC_HOST_CALL_SECRET` when it is
 * read; otherwise random, which is right for one process and wrong for two -
 * a tab served by one instance presents its names to another and is refused.
 */
export function configureChanged(options: { secret?: string | null }): void {
  secret = options.secret ?? null;
  keyed = null;
  signatures.clear();
}

async function key(): Promise<CryptoKey> {
  return (keyed ??= (async () => {
    let raw: Uint8Array<ArrayBuffer>;

    if (!secret && typeof process !== "undefined") {
      secret = process.env?.RSC_HOST_CALL_SECRET ?? null;
    }

    if (secret) raw = new TextEncoder().encode(secret);
    else raw = crypto.getRandomValues(new Uint8Array(32));

    return await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  })());
}

/** A name's signature: the first 16 bytes of an HMAC, base64url, which is what rides in a url. */
export function sign(name: string): Promise<string> {
  let pending = signatures.get(name);

  if (!pending) {
    pending = (async () => {
      const mac = await crypto.subtle.sign(
        "HMAC",
        await key(),
        new TextEncoder().encode(name),
      );

      return base64url(new Uint8Array(mac).slice(0, 16));
    })();

    // Bounded: a name with a visitor's id in it is a new entry per visitor.
    if (signatures.size > 10_000) signatures.clear();
    signatures.set(name, pending);
  }

  return pending;
}

async function verify(name: string, signature: string): Promise<boolean> {
  const expected = await sign(name);

  if (expected.length !== signature.length) return false;

  let differ = 0;

  for (let i = 0; i < expected.length; i++)
    differ |= expected.charCodeAt(i) ^ signature.charCodeAt(i);

  return differ === 0;
}

function base64url(bytes: Uint8Array): string {
  let text = "";

  for (const byte of bytes) text += String.fromCharCode(byte);

  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What a page hands the client for one name: its version at render, and its signature. */
export type SignedName = [version: number, signature: string];

// ── Watching ─────────────────────────────────────────────────────────────────
//
// One stream per open tab, and one ask of the source per process: every
// stream's names are asked about together, on an interval, and a version that
// moved is written to every stream holding its name. A thousand tabs on a
// long-lived server cost the backend one call per interval, not a thousand.
// On a host that answers each request in its own isolate the sharing is
// whatever the isolate serves at once, and a lone stream asks for itself -
// the same code, degrading to one small call per tab per interval.

/** How often the source is asked, when it answered at once. */
export const CHANGES_INTERVAL_MS = 2_000;

/** How long the source may hold one ask. Bounds how long a new tab waits to join the shared ask. */
export const CHANGES_WAIT_MS = 5_000;

interface Stream {
  names: Set<string>;
  send(name: string, version: number): void;
}

const streams = new Set<Stream>();

/** The latest version seen for each name any stream holds. */
const known = new Map<string, number>();

let running = false;
let wake: (() => void) | null = null;
let warned = false;

function observe(name: string, version: number): void {
  if (known.get(name) === version) return;

  known.set(name, version);

  for (const stream of streams)
    if (stream.names.has(name)) stream.send(name, version);
}

/** Mapped to this process's set of streams: what to ask about, relative to what is known. */
function sinceAll(): Record<string, number> {
  const since: Record<string, number> = {};

  for (const stream of streams)
    for (const name of stream.names) since[name] = known.get(name) ?? 0;

  return since;
}

async function loop(): Promise<void> {
  running = true;

  try {
    while (streams.size > 0) {
      const started = Date.now();

      try {
        const moved = await versionSource().changed(
          sinceAll(),
          CHANGES_WAIT_MS,
        );

        for (const [name, version] of Object.entries(moved))
          observe(name, version);
      } catch (error) {
        // A backend blip is not the end of watching. Said once, not per interval.
        if (!warned) {
          warned = true;
          console.warn(
            "[rsc-kit] asking the backend for name versions failed: " +
              (error instanceof Error ? error.message : String(error)),
          );
        }
      }

      // A source that waited used the interval; one that answered at once is
      // asked again after it. A stream opening meanwhile wakes this early.
      const remaining = CHANGES_INTERVAL_MS - (Date.now() - started);

      if (remaining > 0 && streams.size > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, remaining);

          (timer as { unref?: () => void }).unref?.();
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
      }
    }
  } finally {
    running = false;
    // A stream that opened as the loop was ending starts it again.
    if (streams.size > 0) void loop();
  }
}

function parseWatch(
  url: URL,
): { name: string; version: number; signature: string }[] | null {
  const raw = url.searchParams.get("w");

  if (!raw) return null;

  let entries: unknown;

  try {
    entries = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 200)
    return null;

  const parsed: { name: string; version: number; signature: string }[] = [];

  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 3) return null;

    const [name, version, signature] = entry as unknown[];

    if (
      typeof name !== "string" ||
      typeof version !== "number" ||
      typeof signature !== "string"
    )
      return null;

    parsed.push({ name, version, signature });
  }

  return parsed;
}

/**
 * The stream a tab watches its names on: `GET /_rsc/changes?w=[[name, version, signature], …]`.
 *
 * One `data:` line per version that moved, `{ name, version }`, from the moment
 * the stream opens - a name that moved between the render and now is reported
 * at once, so nothing that happened in the gap is missed. Keepalives as an
 * events() route sends them; ends when the browser goes away.
 */
export async function changes(request: Request): Promise<Response> {
  const entries = parseWatch(new URL(request.url));

  if (!entries) return new Response("Bad watch request.", { status: 400 });

  for (const { name, signature } of entries) {
    if (!(await verify(name, signature))) {
      return new Response("Not a name this page was rendered with.", {
        status: 403,
      });
    }
  }

  const since: Record<string, number> = {};

  for (const { name, version } of entries) since[name] = version;

  const encoder = new TextEncoder();
  let stream: Stream | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(sink) {
      const write = (text: string) => {
        try {
          sink.enqueue(encoder.encode(text));
        } catch {
          // Closed under us; the cancel below ends the rest.
        }
      };

      write("retry: 2000\n\n");

      const keepalive = setInterval(
        () => write(": keepalive\n\n"),
        KEEPALIVE_MS,
      );

      (keepalive as { unref?: () => void }).unref?.();

      const me: Stream = {
        names: new Set(Object.keys(since)),
        send: (name, version) => write(frame({ name, version })),
      };

      stream = me;
      streams.add(me);

      const end = () => {
        clearInterval(keepalive);
        streams.delete(me);

        try {
          sink.close();
        } catch {
          // Already closed.
        }
      };

      request.signal.addEventListener("abort", end, { once: true });

      // What is known already answers at once; what is not is seeded with
      // what this tab holds, so the shared ask compares against it.
      for (const [name, version] of Object.entries(since)) {
        const seen = known.get(name);

        if (seen === undefined) known.set(name, version);
        else if (seen !== version) me.send(name, seen);
      }

      // This tab's own first ask, holding as long as the source will: the
      // shared ask may be mid-wait on an older set of names, and a name moving
      // in the seconds before this one joins it must not go unnoticed.
      void versionSource()
        .changed(since, CHANGES_WAIT_MS)
        .then((moved) => {
          for (const [name, version] of Object.entries(moved))
            observe(name, version);
        })
        .catch(() => {});

      if (!running) void loop();
      else wake?.();
    },
    cancel() {
      if (stream) streams.delete(stream);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

/** For tests: forget every stream and version this process has seen. */
export function resetChanges(): void {
  streams.clear();
  known.clear();
  warned = false;
}

/** The url a tab opens to watch, for the client. */
export const CHANGES_PATH = HEADER.changesPath;
