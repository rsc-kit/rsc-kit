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

import { frame, keepaliveMs } from "./events.js";
import { HEADER } from "./headers.js";
import { listenToBroadcast } from "./broadcast.js";

export { listenToBroadcast, type BroadcastOptions } from "./broadcast.js";

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

/**
 * The version a name moves to: the larger of one past where it was and the
 * current time in milliseconds.
 *
 * A counter would do for "it moved", but a counter repeats once its row is
 * gone - deleted to keep the store small, a name starts again from 0 and
 * climbs back to a value some tab is still holding, and that tab misses the
 * change. A time never comes round again, so a name may be forgotten at any
 * moment: a tab holding the old value sees a different one, and at worst
 * refreshes once for nothing. It is also when the name last moved, which is
 * all cleanup needs. Every store bumps with it; one that writes `+ 1` still
 * works, it is just not safe to prune.
 */
export function nextVersion(current = 0): number {
  return Math.max(current + 1, Date.now());
}

/** The safety-net read of a store that listens: longer than any ask waits, so once per ask. */
export const LISTENING_POLL_MS = 30_000;

/** How long a name nobody changes is kept, by the stores that forget on their own. */
export const VERSIONS_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Versions kept in this process: the source without a backend, and the one
 * tests use. A name not changed in `forgetAfter` ms (30 days) is forgotten,
 * swept at most once an hour, so a process up for months does not hold every
 * name it ever saw.
 */
export function memoryVersions(
  options: { forgetAfter?: number } = {},
): VersionSource {
  const forgetAfter = options.forgetAfter ?? VERSIONS_KEPT_MS;
  const versions = new Map<string, number>();
  const waiters = new Set<() => void>();
  let swept = Date.now();

  const sweep = () => {
    const now = Date.now();

    if (now - swept < Math.min(forgetAfter, 60 * 60 * 1000)) return;
    swept = now;

    for (const [name, version] of versions)
      if (version < now - forgetAfter) versions.delete(name);
  };

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
      sweep();
      for (const name of names)
        versions.set(name, nextVersion(versions.get(name)));
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

/** Runs one statement with positional parameters and resolves to its rows. */
export type SqlQuery = (
  text: string,
  params: unknown[],
) => Promise<readonly Record<string, unknown>[]>;

export interface SqlVersionsOptions {
  /**
   * Which database, so a change is one statement - an upsert of every name
   * it moves - rather than a read and a write per name. Left out, the store
   * uses only SQL every database has, at the cost of those extra queries.
   */
  dialect?: "postgres" | "mysql" | "sqlite";
  /**
   * Postgres only: NOTIFY this channel in the same statement as the upsert,
   * so a listening server wakes - and only once the write commits.
   */
  channel?: string;
  /**
   * Your driver, as a function of SQL text and parameters:
   *
   *     query: (text, params) => sql.unsafe(text, params)            // postgres.js, Bun.sql
   *     query: async (text, params) => (await pool.query(text, params)).rows   // node-postgres
   */
  query: SqlQuery;
  /** The table: `CREATE TABLE rsc_versions (name TEXT PRIMARY KEY, version BIGINT NOT NULL)`. */
  table?: string;
  /** How the n-th parameter is written (1-based). Default `?`; Postgres is `(n) => '$' + n`. */
  placeholder?: (n: number) => string;
  /**
   * Called once with a function that wakes every waiting ask, for a database
   * that can say the moment a version moved - Postgres's LISTEN:
   *
   *     listen: (wake) => sql.listen('rsc_versions', wake)
   *
   * Without it, a waiting ask reads the table every `poll` ms.
   */
  listen?: (wake: () => void, health: ListenerHealth) => unknown;
  /**
   * Run after every bump, to tell the other instances - Postgres's NOTIFY:
   *
   *     notify: () => sql.notify('rsc_versions', '')
   */
  notify?: () => unknown;
  /**
   * How often a waiting ask reads the table: every second by default, or,
   * with `listen`, only as a safety net - about once per ask.
   */
  poll?: number;
}

/**
 * Versions in a table every instance shares: the web servers, and the worker
 * that finishes a job and says so. The same table and columns Go's
 * `SQLVersions` uses, so a Go service and a JavaScript worker can share one.
 *
 *     installVersionSource(sqlVersions({
 *       query: (text, params) => sql.unsafe(text, params),
 *       placeholder: (n) => '$' + n,
 *       listen: (wake) => sql.listen('rsc_versions', wake),
 *       notify: () => sql.notify('rsc_versions', ''),
 *     }))
 *
 * Written with an UPDATE and, the first time, an INSERT - two statements any
 * SQL dialect has - rather than an upsert each spells differently. Takes the
 * app's own driver, so the engine has no database dependency of its own.
 */
/**
 * One statement that moves every name to nextVersion: an upsert, in the
 * dialect's own words, and on Postgres the NOTIFY with it. A name is either
 * inserted at `now` or moved to the larger of one more and `now`.
 */
function upsert(
  dialect: "postgres" | "mysql" | "sqlite",
  table: string,
  mark: (n: number) => string,
  names: string[],
  now: number,
  channel?: string,
): [string, unknown[]] {
  if (dialect === "postgres") {
    // $1 is now, the names follow; the channel, if any, comes last.
    const rows = names.map((_, i) => `(${mark(i + 2)}, ${mark(1)})`).join(", ");
    const insert =
      `INSERT INTO ${table} (name, version) VALUES ${rows} ` +
      `ON CONFLICT (name) DO UPDATE SET version = GREATEST(${table}.version + 1, EXCLUDED.version)`;

    if (!channel) return [insert, [now, ...names]];

    // A NOTIFY is delivered when the transaction commits, so a listener is
    // never woken before the change it is told about can be read.
    return [
      `WITH moved AS (${insert} RETURNING 1) SELECT pg_notify(${mark(names.length + 2)}, '') FROM (SELECT count(*) FROM moved) AS done`,
      [now, ...names, channel],
    ];
  }

  const rows = names.map(() => `(${mark(1)}, ${mark(1)})`).join(", ");
  const params = names.flatMap((name) => [name, now]);

  return dialect === "mysql"
    ? [
        `INSERT INTO ${table} (name, version) VALUES ${rows} ON DUPLICATE KEY UPDATE version = GREATEST(version + 1, VALUES(version))`,
        params,
      ]
    : [
        `INSERT INTO ${table} (name, version) VALUES ${rows} ON CONFLICT (name) DO UPDATE SET version = MAX(version + 1, excluded.version)`,
        params,
      ];
}

/** A store whose old names can be cleared out: the SQL ones. */
export interface PrunableVersions extends VersionSource {
  /**
   * Delete every name not changed in `olderThan` ms (30 days by default).
   * Always safe: a version is a time and never comes round again, so a tab
   * still holding a pruned name sees it differ and refreshes once. Run it
   * from a scheduled job - a daily one is plenty.
   */
  prune(olderThan?: number): Promise<void>;
}

export function sqlVersions(options: SqlVersionsOptions): PrunableVersions {
  const { query } = options;
  const table = options.table ?? "rsc_versions";
  const mark = options.placeholder ?? (() => "?");

  const source = createVersions(
    {
      async read(names) {
        const rows = await query(
          `SELECT name, version FROM ${table} WHERE name IN (${names.map((_, i) => mark(i + 1)).join(", ")})`,
          names,
        );

        // A BIGINT comes back as a string from most drivers.
        return Object.fromEntries(
          rows.map((row) => [String(row.name), Number(row.version)]),
        );
      },
      async bump(names) {
        if (options.dialect) {
          await query(
            ...upsert(
              options.dialect,
              table,
              mark,
              names,
              Date.now(),
              options.channel,
            ),
          );

          return;
        }

        // nextVersion, in SQL every dialect has: CASE rather than GREATEST,
        // which SQLite spells MAX. The time is this process's, passed in, so
        // the database's clock never has to agree with it.
        const update =
          `UPDATE ${table} SET version = CASE WHEN version + 1 > ${mark(1)} THEN version + 1 ELSE ${mark(2)} END ` +
          `WHERE name = ${mark(3)}`;
        const insert = `INSERT INTO ${table} (name, version) VALUES (${mark(1)}, ${mark(2)})`;

        for (const name of names) {
          const now = Date.now();

          // The row count is not something every driver reports the same way,
          // so ask: a name with no row yet gets one.
          const [exists] = await query(
            `SELECT 1 AS found FROM ${table} WHERE name = ${mark(1)}`,
            [name],
          );

          if (exists) {
            await query(update, [now, now, name]);
            continue;
          }

          try {
            await query(insert, [name, now]);
          } catch {
            // Another instance inserted it first: bump that one.
            await query(update, [now, now, name]);
          }
        }
      },
      listen: options.listen,
      notify: options.notify,
    },
    { poll: options.poll },
  );

  return {
    ...source,
    async prune(olderThan = VERSIONS_KEPT_MS) {
      await query(`DELETE FROM ${table} WHERE version < ${mark(1)}`, [
        Date.now() - olderThan,
      ]);
    },
  };
}

/**
 * Where versions are kept, as the app writes it for its own database: the
 * three things rsc-kit cannot know about your storage, and nothing else.
 * `createVersions` does the rest - comparing, waiting, waking.
 *
 *     // Drizzle
 *     read: async (names) => Object.fromEntries(
 *       (await db.select().from(rscVersions).where(inArray(rscVersions.name, names)))
 *         .map((r) => [r.name, Number(r.version)])),
 *     bump: async (names) => { for (const name of names) await db.insert(rscVersions)
 *       .values({ name, version: 1 })
 *       .onConflictDoUpdate({ target: rscVersions.name, set: { version: sql`${rscVersions.version} + 1` } }) },
 *
 *     // Redis
 *     read: async (names) => Object.fromEntries((await redis.mget(names.map(k)))
 *       .map((v, i) => [names[i], Number(v ?? 0)])),
 *     bump: async (names) => { await Promise.all(names.map((n) => redis.incr(k(n)))) },
 */
export interface VersionStore {
  /** The current version of each name asked for. A name it has never seen may be left out: it is 0. */
  read(names: string[]): Promise<Record<string, number>>;
  /**
   * Move each name's version to `nextVersion(current)` - one past where it
   * was, or the current time in ms if that is larger. Watchers only compare,
   * so any new value works; this one never repeats, which is what makes it
   * safe to delete a name later. A plain `+ 1` works too, until a row is
   * deleted.
   */
  bump(names: string[]): Promise<void>;
  /**
   * Called once with a function that wakes every waiting ask, when the store
   * can say the moment a version moved - Postgres LISTEN, Redis SUBSCRIBE.
   * Without it a waiting ask reads again every `poll` ms.
   *
   * Given `health` too: a store that finds it hears nothing - a Postgres
   * listener behind a pooler in transaction mode - calls `health.deaf(why)`,
   * and rsc-kit says so and goes back to reading every second.
   */
  listen?(wake: () => void, health: ListenerHealth): unknown;
  /** Run after a bump, to tell the other instances listening: Postgres NOTIFY, Redis PUBLISH. */
  notify?(): unknown;
}

/**
 * A version source over any store: SQL through any driver or ORM - Drizzle,
 * Prisma, Kysely, Knex - or Redis, or anything with a read and an increment.
 *
 *     installVersionSource(createVersions({ read, bump, listen, notify }))
 *
 * rsc-kit owns the rest: an ask waits up to the time it was given for a
 * version to differ, reading every `poll` ms (1000 by default) or the moment
 * `listen` wakes it, and a bump in this process wakes this process's asks at
 * once whatever the store.
 */
export function createVersions(
  store: VersionStore,
  options: { poll?: number } = {},
): VersionSource {
  // A store that listens is woken the moment a version moves, so reading the
  // table on a timer is only a safety net - for a listening connection that
  // dropped without a word. Once an ask is enough: about every five seconds
  // per server, where one that cannot listen reads every second.
  let listening = Boolean(store.listen);
  const poll = () => options.poll ?? (listening ? LISTENING_POLL_MS : 1_000);
  const waiters = new Set<() => void>();
  const wakeAll = () => {
    for (const wake of [...waiters]) wake();
  };

  // A store that can listen wakes the renderer the way anything else does -
  // through wakeOn, which starts it with the first watching tab and never in
  // a build. A wake also ends an ask this store is holding.
  if (store.listen) {
    const listen = store.listen.bind(store);

    wakeOn((wake, health) =>
      listen(wake, {
        deaf: (reason) => {
          listening = false;
          health.deaf(reason);
        },
      }),
    );
  }
  wakers().sleepers.add(wakeAll);

  const read = async (names: string[]): Promise<Record<string, number>> => {
    if (names.length === 0) return {};

    const found = await store.read(names);

    return Object.fromEntries(
      names.map((name) => [name, Number(found[name] ?? 0)]),
    );
  };

  return {
    async changed(since, wait) {
      // Only a server with a tab watching asks with a wait - never a build -
      // so this is a safe moment to start listening, as is the first tab.
      if (wait > 0) startWakers();

      const names = Object.keys(since);
      const deadline = Date.now() + Math.max(0, wait);

      for (;;) {
        const versions = await read(names);
        const differ: Record<string, number> = {};

        for (const name of names)
          if (versions[name] !== since[name])
            differ[name] = versions[name] ?? 0;

        const remaining = deadline - Date.now();

        if (Object.keys(differ).length > 0 || remaining <= 0) return differ;

        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            waiters.delete(done);
            resolve();
          };
          const timer = setTimeout(done, Math.min(poll(), remaining));

          (timer as { unref?: () => void }).unref?.();
          waiters.add(done);
        });
      }
    },
    async bump(names) {
      const unique = [...new Set(names)];

      if (unique.length === 0) return;

      await store.bump(unique);
      wakeAll();
      if (store.notify) await store.notify();
    },
  };
}

/** The parts of a Postgres client `postgresVersions` uses: postgres.js and `Bun.sql` both have them. */
export interface PostgresClient {
  unsafe(
    text: string,
    params?: unknown[],
  ): PromiseLike<readonly Record<string, unknown>[]>;
  /** postgres.js and Bun.sql have it; with it, a waiting ask hears another instance at once. */
  listen?(channel: string, onNotify: (payload?: string) => void): unknown;
  notify?(channel: string, payload: string): unknown;
}

/**
 * Versions in Postgres, from the client the app already has:
 *
 *     installVersionSource(postgresVersions(sql))
 *
 * `sqlVersions` with Postgres's placeholders, and - when the client can
 * LISTEN, as postgres.js and `Bun.sql` (Bun 1.4+) can - a change on one
 * instance wakes the waiting asks on every other at once, rather than on
 * their next read of the table. Without it, the table is read once a second
 * while an ask waits.
 *
 *     CREATE TABLE rsc_versions (name TEXT PRIMARY KEY, version BIGINT NOT NULL)
 */
export function postgresVersions(
  sql: PostgresClient,
  options: {
    table?: string;
    channel?: string;
    poll?: number;
    /**
     * A client to listen on, when `sql` goes through a connection pooler in
     * transaction mode - PgBouncer, or DigitalOcean's, Supabase's or Neon's
     * pooled connection - which hands the server connection back after each
     * statement, so a LISTEN on it hears nothing. A direct or session-mode
     * connection; reads and writes stay on `sql`. One connection per process.
     */
    listenWith?: PostgresClient;
    /**
     * `false`: do not listen - read every second instead, on purpose. For a
     * database whose direct connections are too few to spend one per process
     * on, behind a pooler that cannot listen. No listener, so no probe and no
     * warning about one. A change made in this process still reaches its own
     * tabs at once; one made elsewhere within about a second.
     */
    listen?: boolean;
  } = {},
): PrunableVersions {
  const channel = options.channel ?? "rsc_versions";
  const listener = options.listenWith ?? sql;
  const listenOn =
    options.listen === false ? undefined : listener.listen?.bind(listener);

  // One statement per change: the upsert of every name, and the NOTIFY that
  // wakes every listening server - this one included - when it commits.
  return sqlVersions({
    query: async (text, params) => await sql.unsafe(text, params),
    placeholder: (n) => "$" + n,
    dialect: "postgres",
    channel,
    table: options.table,
    poll: options.poll,
    listen: listenOn
      ? async (wake, health) => {
          // A probe, sent the way a change is - through `sql` - and listened
          // for on the listening connection. Behind a transaction-mode pooler
          // the LISTEN lands on a connection the pooler takes back, sending
          // still works, and nothing says the listener is deaf: changes from
          // other instances would wait for the safety-net read. The probe
          // not arriving is how that is found out - once, as listening starts.
          const probe = "rsc-kit:probe:" + crypto.randomUUID();
          let heard = false;

          await listenOn(channel, (payload) => {
            if (payload === probe) heard = true;
            else wake();
          });
          await sql.unsafe("SELECT pg_notify($1, $2)", [channel, probe]);

          const timer = setTimeout(() => {
            if (heard) return;

            health.deaf(
              "listening on Postgres receives no notifications - is the connection going through a pooler " +
                "in transaction mode (PgBouncer; DigitalOcean, Supabase or Neon pooled connections)? " +
                "Pass a direct or session-mode connection: postgresVersions(sql, { listenWith }). " +
                "Reading every second meanwhile.",
            );
          }, LISTEN_PROBE_MS);

          (timer as { unref?: () => void }).unref?.();
        }
      : undefined,
  });
}

/** How long a listener's probe may take to come back before it counts as deaf. */
export const LISTEN_PROBE_MS = 5_000;

const SOURCE = Symbol.for("rsc-kit.version-source");
const BACKEND_SOURCE = Symbol.for("rsc-kit.backend-version-source");
const LOCAL_SOURCE = Symbol.for("rsc-kit.local-version-source");
const globals = globalThis as Record<symbol, unknown>;

/**
 * Install where versions are read from - a table, Redis, any store - for this
 * process; `null` takes it out again.
 *
 * The app's choice wins over the backend's: with a Go or Laravel backend that
 * writes its versions to a store this process can read too, reading it here
 * means watching costs the backend nothing.
 */
export function installVersionSource(
  source: VersionSource | (() => VersionSource) | null,
): void {
  globals[SOURCE] = source;
}

/** The engine's, when a backend is installed: its versions, read through it. Not for apps. */
export function installBackendVersionSource(
  source: VersionSource | null,
): void {
  globals[BACKEND_SOURCE] = source;
}

/** The source in use: the app's, else the backend's, else this process's own. */
export function versionSource(): VersionSource {
  // A factory, made into the store on first use: a store made in register()
  // would make its database client in the build too, which runs register()
  // without the database's settings.
  if (typeof globals[SOURCE] === "function")
    globals[SOURCE] = (globals[SOURCE] as () => VersionSource)();

  const chosen =
    (globals[SOURCE] as VersionSource | null | undefined) ??
    (globals[BACKEND_SOURCE] as VersionSource | null | undefined);

  if (chosen) return chosen;

  let local = globals[LOCAL_SOURCE] as VersionSource | undefined;

  if (!local) {
    local = globals[LOCAL_SOURCE] = memoryVersions();

    // The fallback works in development and in tests, which are one process,
    // and fails silently in production with two: a change on one instance
    // never reaches the tabs on another. Said once, at the first use. An app
    // that really is one instance installs memoryVersions() itself, which is
    // a choice rather than a fallback, and is not warned.
    if (production()) {
      console.warn(
        "[rsc-kit] refreshOn versions are kept in this process only: a change made on another " +
          "instance, or in a worker, will not reach the tabs this one serves. Install a store every " +
          "process shares with installVersionSource() in instrumentation.ts - sqlVersions for MySQL " +
          "or SQLite, postgresVersions for Postgres, createVersions for anything else: " +
          "https://docs.rsc-kit.dev/guides/live-data#where-the-versions-live. For a deploy that is one " +
          "instance, installVersionSource(memoryVersions()) says so.",
      );
    }
  }

  return local;
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
  // On Workers with a hub, the tabs are held by the hub, not this isolate:
  // tell it, so they hear now rather than at the hub's next read.
  await pokeHub();
}

// ── Tokens ───────────────────────────────────────────────────────────────────
//
// A tab may watch exactly the names its page was rendered with. Rather than
// remembering what each tab was given - state, which a Worker cannot keep
// between requests - every name goes to the client signed, and comes back
// with its signature. Verified, not looked up, so a watch request is
// stateless, and a browser cannot make up a name to watch.

/** Thrown when a production server has no key to sign names with. */
export class MissingSigningSecret extends Error {
  constructor() {
    super(
      "refreshOn needs a signing secret in production, the same on every instance: set RSC_SIGNING_SECRET " +
        "to a long random string. Without one, each instance would sign with its own random key, and a tab " +
        "served by one would be refused by the next.",
    );
    this.name = "MissingSigningSecret";
  }
}

// On the global rather than in this module: an app imports this file through
// its own copy of the package, and a key configured there must be the key the
// engine's copy signs and verifies with.
const KEY = Symbol.for("rsc-kit.signing-key");

interface Keying {
  secret: string | null;
  keyed: Promise<CryptoKey> | null;
  signatures: Map<string, Promise<string>>;
}

function keying(): Keying {
  return ((globals[KEY] as Keying | undefined) ??= {
    secret: null,
    keyed: null,
    signatures: new Map(),
  });
}

const env = (name: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name] || undefined;

const production = (): boolean => env("NODE_ENV") === "production";

/**
 * The secret names are signed with, when it does not come from the
 * environment. Normally it does: `RSC_SIGNING_SECRET`, the same on every
 * instance, or a tab served by one is refused by another.
 *
 * Its own secret, not the backend's host-call secret: that one authorises
 * calls between the renderer and a backend, and an app with no backend has
 * no reason to have it. Two jobs, two keys - one leaking does not hand out
 * the other.
 */
export function configureChanged(options: { secret?: string | null }): void {
  const state = keying();

  state.secret = options.secret ?? null;
  state.keyed = null;
  state.signatures.clear();
}

/** The secret in use: configured, or from the environment; null when there is none. */
function secretInUse(): string | null {
  const state = keying();

  return state.secret ?? env("RSC_SIGNING_SECRET") ?? null;
}

/**
 * Refuse, in production, to sign with a key nobody else has.
 *
 * A random key is right for one process - a dev server - and silently wrong
 * for two: every tab served by one instance is refused by the next, and never
 * refreshes. The server calls this on its first request when the app uses
 * refreshOn, so the misconfiguration is an error at once rather than a page
 * that quietly stops updating.
 */
export function assertSigningSecret(): void {
  if (!secretInUse() && production()) throw new MissingSigningSecret();
}

let warnedRandom = false;

async function key(): Promise<CryptoKey> {
  const state = keying();

  return (state.keyed ??= (async () => {
    const secret = secretInUse();
    let raw: Uint8Array<ArrayBuffer>;

    if (secret) raw = new TextEncoder().encode(secret);
    else if (production()) throw new MissingSigningSecret();
    else {
      if (!warnedRandom) {
        warnedRandom = true;
        console.warn(
          "[rsc-kit] refreshOn is signing with a random key, which is fine for one dev server. " +
            "Set RSC_SIGNING_SECRET before running more than one instance.",
        );
      }

      raw = crypto.getRandomValues(new Uint8Array(32));
    }

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
  const { signatures } = keying();
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

/**
 * A stream gone: and with it every name no other stream holds, which this
 * process has no reason to remember. Kept, the latest version of every name
 * any tab ever watched piled up for as long as the server ran.
 */
function close(stream: Stream): void {
  if (!streams.delete(stream)) return;

  for (const name of stream.names) {
    let held = false;

    for (const other of streams) {
      if (other.names.has(name)) {
        held = true;
        break;
      }
    }

    if (!held) known.delete(name);
  }
}

/** Mapped to this process's set of streams: what to ask about, relative to what is known. */
function sinceAll(): Record<string, number> {
  const since: Record<string, number> = {};

  for (const stream of streams)
    for (const name of stream.names) since[name] = known.get(name) ?? 0;

  return since;
}

// ── Waking ───────────────────────────────────────────────────────────────────
//
// A backend that cannot hold a question open - PHP - is asked again on an
// interval. Something that can say "a version moved" the moment it does -
// a broadcast, a Redis channel - makes that interval a safety net: the
// renderer asks the moment it is woken, and otherwise rarely.

const WAKERS = Symbol.for("rsc-kit.wakers");

interface Wakers {
  listens: ((wake: () => void, health: ListenerHealth) => unknown)[];
  started: boolean;
  /** A wake that came while an ask was in flight: ask again straight after. */
  pending: boolean;
  /** Asks a store is holding open, ended by a wake. */
  sleepers: Set<() => void>;
}

function wakers(): Wakers {
  return ((globals[WAKERS] as Wakers | undefined) ??= {
    listens: [],
    started: false,
    pending: false,
    sleepers: new Set(),
  });
}

/**
 * Wake the renderer when a version may have moved, so it asks then rather
 * than on its next interval.
 *
 *     wakeOn(listenToBroadcast({ url, key }))           // a broadcast server
 *     wakeOn((wake) => subscriber.subscribe('rsc', wake)) // a Redis channel
 *
 * `listen` is given a function to call - it carries no names and no data;
 * the renderer asks wherever the versions live, as always. It is started
 * when the first tab starts watching, never in a build. With one installed,
 * a backend that answers at once is asked again every 30 seconds as a safety
 * net instead of every two.
 */
/** What a listener is told besides how to wake: how to say it hears nothing. */
export interface ListenerHealth {
  /** This listener will never wake anything: say why, once, and stop counting on it. */
  deaf(reason: string): void;
}

export function wakeOn(
  listen: (wake: () => void, health: ListenerHealth) => unknown,
): void {
  const state = wakers();

  state.listens.push(listen);
  if (state.started) start(listen);
}

/**
 * Start one listener; one that fails - a database not up yet - is tried
 * again, backing off to thirty seconds. Until it is up the timer stands in.
 */
function start(
  listen: (wake: () => void, health: ListenerHealth) => unknown,
  failures = 0,
): void {
  const health: ListenerHealth = {
    deaf: (reason) => {
      const state = wakers();
      const at = state.listens.indexOf(listen);

      // No longer counted: the renderer goes back to asking on the shorter
      // interval, as it does with nothing to wake it.
      if (at === -1) return;
      state.listens.splice(at, 1);
      console.warn("[rsc-kit] " + reason);
    },
  };

  void Promise.resolve()
    .then(() => listen(signal, health))
    .catch((error: unknown) => {
      if (failures === 0) {
        console.warn(
          "[rsc-kit] a wakeOn listener failed to start, trying again: " +
            (error instanceof Error ? error.message : String(error)),
        );
      }

      const retry = setTimeout(
        () => start(listen, failures + 1),
        Math.min(30_000, 1000 * 2 ** failures),
      );

      (retry as { unref?: () => void }).unref?.();
    });
}

/** Something said a version may have moved: ask now, and end any ask a store is holding. */
function signal(): void {
  const state = wakers();

  state.pending = true;
  wake?.();
  for (const sleeper of [...state.sleepers]) sleeper();
}

function startWakers(): void {
  const state = wakers();

  if (state.started) return;
  state.started = true;

  // Set in the environment, not guessed: a broadcast server to listen to.
  const url = env("RSC_BROADCAST_URL");
  const key = env("RSC_BROADCAST_KEY");

  if (url && key) state.listens.push(listenToBroadcast({ url, key }));

  for (const listen of state.listens) start(listen);
}

async function loop(): Promise<void> {
  running = true;
  startWakers();

  try {
    while (streams.size > 0) {
      const started = Date.now();
      const state = wakers();

      state.pending = false;

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
      // asked again after it - or, with something to wake it, only as a
      // safety net. A stream opening, or a wake, ends the wait early; a wake
      // that came during the ask is answered at once.
      const interval =
        state.listens.length > 0 ? LISTENING_POLL_MS : CHANGES_INTERVAL_MS;
      const remaining = state.pending ? 0 : interval - (Date.now() - started);

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
        keepaliveMs(),
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
        close(me);

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
      if (stream) close(stream);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: a proxy or CDN in front must not compress or buffer
      // it either - Cloudflare compresses text unless told not to.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** For tests: forget every stream and version this process has seen. */
/** For tests: how many names this process remembers for its open streams. */
export function rememberedNames(): number {
  return known.size;
}

export function resetChanges(): void {
  warnedHub = false;
  delete globals[WAKERS];
  streams.clear();
  known.clear();
  warned = false;
  delete globals[LOCAL_SOURCE];
}

/** The url a tab opens to watch, for the client. */
export const CHANGES_PATH = HEADER.changesPath;

// ── The hub ──────────────────────────────────────────────────────────────────
//
// On Workers each isolate watches for the tabs it happens to hold, which is
// often one: an ask per tab per interval, a listener per isolate. A Durable
// Object is one place every isolate can reach. With RSC_CHANGES_HUB naming
// its binding, every tab's stream is forwarded to one instance of it, which
// runs the shared ask above for all of them - one ask an interval for the
// whole deployment, one listener, and a changed() anywhere wakes it at once.
//
// Opt-in, by name: the binding is the app's, declared in its wrangler config,
// and nothing here guesses that a Durable Object is there to use.

/** Marks a request the hub sent itself; its value is signed, so a browser cannot. */
const HUB_HEADER = "x-rsc-changes-hub";
/** The one instance every isolate's streams go to. */
const HUB_INSTANCE = "rsc-kit-changes";
/** What the header's value is the signature of. */
const HUB_PROOF = "rsc-kit:changes-hub";

interface HubNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

let warnedHub = false;

/** The hub's stub, when RSC_CHANGES_HUB names a Durable Object binding; null otherwise. */
async function hubStub(
  request?: Request,
): Promise<{ fetch(request: Request): Promise<Response> } | null> {
  const binding = env("RSC_CHANGES_HUB");

  if (!binding) return null;

  let bindings = (
    request as { runtime?: { cloudflare?: { env?: Record<string, unknown> } } } | undefined
  )?.runtime?.cloudflare?.env;

  // Nitro's Workers entry keeps the bindings here for code with no request -
  // changed() from a webhook's handler.
  bindings ??= (globalThis as { __env__?: Record<string, unknown> }).__env__;

  if (!bindings) {
    try {
      // Computed, so neither the bundler nor tsc looks for a module only the
      // Workers runtime has.
      const specifier = "cloudflare:workers";

      bindings = ((await import(/* @vite-ignore */ specifier)) as { env: Record<string, unknown> }).env;
    } catch {
      bindings = undefined;
    }
  }

  const namespace = bindings?.[binding] as HubNamespace | undefined;

  if (!namespace || typeof namespace.idFromName !== "function") {
    if (!warnedHub) {
      warnedHub = true;
      console.warn(
        `[rsc-kit] RSC_CHANGES_HUB names ${JSON.stringify(binding)}, which is not a Durable Object binding ` +
          "here: each isolate watches for its own tabs. Declare the binding in wrangler config: " +
          "https://docs.rsc-kit.dev/guides/live-data#one-hub-on-workers",
      );
    }

    return null;
  }

  return namespace.get(namespace.idFromName(HUB_INSTANCE));
}

/** Whether this request came from an isolate forwarding to the hub. */
async function fromIsolate(request: Request): Promise<boolean> {
  const proof = request.headers.get(HUB_HEADER);

  return proof !== null && (await verify(HUB_PROOF, proof));
}

/** Tell the hub something changed, so the tabs it holds hear at once. */
async function pokeHub(): Promise<void> {
  let stub: Awaited<ReturnType<typeof hubStub>>;

  try {
    stub = await hubStub();
  } catch {
    return;
  }

  if (!stub) return;

  try {
    await stub.fetch(
      new Request("https://hub" + HEADER.changesPath, {
        method: "POST",
        headers: { [HUB_HEADER]: await sign(HUB_PROOF) },
      }),
    );
  } catch (error) {
    // The change is in the store; the hub reads it at its next ask.
    if (!warnedHub) {
      warnedHub = true;
      console.warn(
        "[rsc-kit] telling the changes hub failed; its tabs hear at its next read: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}

/**
 * The changes endpoint: a tab's stream here, or - with a hub - in the hub,
 * where every tab's is. The hub itself answers what isolates forward to it:
 * a stream to hold, or a poke to ask now.
 */
export async function serveChanges(request: Request): Promise<Response> {
  // Forwarded, but not with this key: never forwarded again, which would be
  // a loop - the hub reaching itself - and never served as if from the hub.
  if (request.headers.has(HUB_HEADER) && !(await fromIsolate(request))) {
    return new Response("Not from this deployment's isolates.", { status: 403 });
  }

  if (request.headers.has(HUB_HEADER)) {
    if (request.method === "POST") {
      signal();

      return new Response(null, { status: 204 });
    }

    return await changes(request);
  }

  if (request.method !== "GET") return new Response("Method not allowed.", { status: 405 });

  const stub = await hubStub(request);

  if (!stub) return await changes(request);

  const headers = new Headers(request.headers);

  headers.set(HUB_HEADER, await sign(HUB_PROOF));

  const held = await stub.fetch(new Request(request.url, { method: "GET", headers, signal: request.signal }));

  // A stub's response has immutable headers, and the response is still the
  // app's to finish - the server adds its own on the way out.
  return new Response(held.body, held);
}
