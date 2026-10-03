/**
 * Names on the server: versions, where they come from, the signed names a tab
 * is handed, and the stream it watches them on.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createRscHandler } from "../../src/host";
import {
  backendVersions,
  changed,
  assertSigningSecret,
  configureChanged,
  MissingSigningSecret,
  createVersions,
  postgresVersions,
  sqlVersions,
  type SqlVersionsOptions,
  installBackendVersionSource,
  installVersionSource,
  memoryVersions,
  rememberedNames,
  resetChanges,
  sign,
  versionSource,
  changes,
} from "../../src/changed";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("names.test.ts");

beforeEach(() => {
  installVersionSource(null);
  resetChanges();
  configureChanged({ secret: "test-secret" });
});

afterEach(() => {
  installVersionSource(null);
  resetChanges();
  configureChanged({ secret: null });
});

/** A version a bump writes: a time in ms, so never one a tab held before. */
const moved = expect.any(Number);

/** The version a name is at in this source. */
const at = async (source: { changed: (s: Record<string, number>, w: number) => Promise<Record<string, number>> }, name: string) =>
  (await source.changed({ [name]: -1 }, 0))[name] ?? 0;

describe("versions kept in this process", () => {
  test("a name nobody changed is at 0; a change moves it; only what differs is answered", async () => {
    const source = memoryVersions();

    expect(await source.changed({ a: -1, b: -1 }, 0)).toEqual({ a: 0, b: 0 });
    expect(await source.changed({ a: 0, b: 0 }, 0)).toEqual({});

    source.bump(["a"]);

    expect(await source.changed({ a: 0, b: 0 }, 0)).toEqual({ a: moved });
  });

  test("a bump moves a name past where it was and to at least now, so a version never repeats", async () => {
    const source = memoryVersions();
    const before = Date.now();

    source.bump(["a"]);
    const first = await at(source, "a");
    source.bump(["a"]);
    const second = await at(source, "a");

    expect(first).toBeGreaterThanOrEqual(before);
    expect(second).toBeGreaterThan(first);
  });

  test("a name not changed in a while is forgotten, and comes back at a version no tab held", async () => {
    const source = memoryVersions({ forgetAfter: 20 });

    source.bump(["old"]);
    const held = await at(source, "old");

    await new Promise((r) => setTimeout(r, 40));
    source.bump(["other"]); // a bump sweeps

    expect(await at(source, "old")).toBe(0);

    source.bump(["old"]);
    expect(await at(source, "old")).toBeGreaterThan(held);
  });

  test("waits for a change, and no longer than asked", async () => {
    const source = memoryVersions();
    const started = Date.now();
    const waited = source.changed({ a: 0 }, 5_000);

    setTimeout(() => source.bump(["a"]), 30);

    expect(await waited).toEqual({ a: moved });
    expect(Date.now() - started).toBeLessThan(1_000);

    const bounded = Date.now();

    expect(await source.changed({ a: await at(source, "a") }, 50)).toEqual({});
    expect(Date.now() - bounded).toBeGreaterThanOrEqual(45);
  });

  test("changed() bumps the installed source", async () => {
    await changed("orders", "orders");

    expect(await versionSource().changed({ orders: 0 }, 0)).toEqual({
      orders: moved,
    });
  });
});

describe("versions kept by a backend", () => {
  test("are asked through __rsc.changed with what is held and how long to wait", async () => {
    const asked: unknown[] = [];
    const source = backendVersions(async (name, ...args) => {
      asked.push([name, ...args]);

      return { versions: { a: 7 } };
    });

    expect(await source.changed({ a: 0 }, 1_500)).toEqual({ a: 7 });
    expect(asked).toEqual([
      ["__rsc.changed", { since: { a: 0 }, wait: 1_500 }],
    ]);
  });

  test("a backend without the function is answered from this process instead, from then on", async () => {
    let calls = 0;
    const source = backendVersions(async () => {
      calls++;
      throw new Error(
        'Host call "__rsc.changed" failed: No host function named "__rsc.changed".',
      );
    });

    expect(await source.changed({ a: -1 }, 0)).toEqual({ a: 0 });
    await source.bump(["a"]);
    expect(await source.changed({ a: 0 }, 0)).toEqual({ a: moved });
    expect(calls).toBe(1);
  });

  test("any other failure is the caller's, and changed() is refused: the versions are the backend's", async () => {
    const source = backendVersions(async () => {
      throw new Error('Host call "__rsc.changed" could not reach the host');
    });

    await expect(source.changed({ a: 0 }, 0)).rejects.toThrow(
      "could not reach",
    );
    expect(() => source.bump(["a"])).toThrow("rsckit.Changed");
  });
});

describe("signed names", () => {
  test("are stable for a secret, differ by name and by secret, and are short", async () => {
    const a = await sign("team:1:repos");

    expect(await sign("team:1:repos")).toBe(a);
    expect(await sign("team:2:repos")).not.toBe(a);
    expect(a.length).toBeLessThanOrEqual(24);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);

    configureChanged({ secret: "another" });
    expect(await sign("team:1:repos")).not.toBe(a);
  });
});

const read = async (
  response: Response,
  until: (text: string) => boolean,
  timeoutMs = 3_000,
): Promise<string> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let text = "";

  while (!until(text) && Date.now() < deadline) {
    const next = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: undefined }>((r) =>
        setTimeout(() => r({ done: true }), 200),
      ),
    ]);

    if (next.value) text += decoder.decode(next.value);
    if (next.done && !next.value) continue;
  }

  await reader.cancel();

  return text;
};

const watching = async (entries: [string, number][]): Promise<Response> => {
  const signed = await Promise.all(
    entries.map(async ([name, version]) => [name, version, await sign(name)]),
  );

  return changes(
    new Request(
      "https://app.test/_rsc/changes?w=" +
        encodeURIComponent(JSON.stringify(signed)),
    ),
  );
};

describe("the watch stream", () => {
  test("refuses a name not signed for this app, and a malformed request", async () => {
    const forged = await changes(
      new Request(
        "https://app.test/_rsc/changes?w=" +
          encodeURIComponent(JSON.stringify([["secret:name", 0, "nope"]])),
      ),
    );

    expect(forged.status).toBe(403);
    expect(
      (await changes(new Request("https://app.test/_rsc/changes"))).status,
    ).toBe(400);
    expect(
      (await changes(new Request("https://app.test/_rsc/changes?w=notjson")))
        .status,
    ).toBe(400);
  });

  test("is an event stream that reports a name the moment it moves", async () => {
    const response = await watching([["orders", 0]]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    setTimeout(() => void changed("orders"), 30);

    const text = await read(response, (t) => t.includes('"orders"'));

    expect(text).toMatch(/data: \{"name":"orders","version":\d{13}\}/);
  });

  test("reports a change that happened between the render and the stream opening", async () => {
    // The page was rendered with orders at 0; by the time the tab connects it
    // has moved. Nothing in that gap may be missed.
    await changed("orders");

    const response = await watching([["orders", 0]]);
    const text = await read(response, (t) => t.includes('"orders"'));

    expect(text).toMatch(/\{"name":"orders","version":\d{13}\}/);
  });

  test("a tab already at the current version hears nothing until it moves again", async () => {
    await changed("orders");

    const response = await watching([["orders", await at(versionSource(), "orders")]]);
    const quiet = await read(response, (t) => t.includes("data:"), 400);

    expect(quiet).not.toContain("data:");
  });

  test("two tabs share one ask, and both hear the change", async () => {
    const asks: Record<string, number>[] = [];
    const inner = memoryVersions();

    installVersionSource({
      changed: (since, wait) => {
        asks.push(since);

        return inner.changed(since, wait);
      },
      bump: (names) => inner.bump(names),
    });

    const one = await watching([
      ["orders", 0],
      ["stock", 0],
    ]);
    const two = await watching([["orders", 0]]);

    setTimeout(() => inner.bump(["orders"]), 50);

    const [a, b] = await Promise.all([
      read(one, (t) => t.includes('"orders"')),
      read(two, (t) => t.includes('"orders"')),
    ]);

    expect(a).toMatch(/\{"name":"orders","version":\d{13}\}/);
    expect(b).toMatch(/\{"name":"orders","version":\d{13}\}/);

    // Every ask the loop made covered both tabs' names at once.
    const shared = asks.filter(
      (since) => "stock" in since && "orders" in since,
    );

    expect(shared.length).toBeGreaterThan(0);
  });
});

// ── The signing key ──────────────────────────────────────────────────────────

describe("the signing key", () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const name of [
      "RSC_SIGNING_SECRET",
      "RSC_HOST_CALL_SECRET",
      "NODE_ENV",
    ]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  const signedWith = async (env: Record<string, string>) => {
    configureChanged({ secret: null });
    delete process.env.RSC_SIGNING_SECRET;
    delete process.env.RSC_HOST_CALL_SECRET;
    Object.assign(process.env, env);

    return sign("team:1:repos");
  };

  test("is RSC_SIGNING_SECRET, and never the backend's host-call secret", async () => {
    const signing = await signedWith({ RSC_SIGNING_SECRET: "one" });

    expect(await signedWith({ RSC_SIGNING_SECRET: "two" })).not.toBe(signing);
    expect(
      await signedWith({
        RSC_SIGNING_SECRET: "one",
        RSC_HOST_CALL_SECRET: "two",
      }),
    ).toBe(signing);

    // A host-call secret alone is not a signing secret: in production, refused.
    process.env.NODE_ENV = "production";
    await expect(
      signedWith({ RSC_HOST_CALL_SECRET: "one" }),
    ).rejects.toBeInstanceOf(MissingSigningSecret);
  });

  test("in production, missing, is refused rather than made up", async () => {
    configureChanged({ secret: null });
    delete process.env.RSC_SIGNING_SECRET;
    delete process.env.RSC_HOST_CALL_SECRET;
    process.env.NODE_ENV = "production";

    expect(() => assertSigningSecret()).toThrow("RSC_SIGNING_SECRET");
    await expect(sign("team:1:repos")).rejects.toBeInstanceOf(
      MissingSigningSecret,
    );

    process.env.RSC_SIGNING_SECRET = "shared";
    configureChanged({ secret: null });
    expect(() => assertSigningSecret()).not.toThrow();
  });

  test("outside production, missing, is a random key for this one process", async () => {
    configureChanged({ secret: null });
    delete process.env.RSC_SIGNING_SECRET;
    delete process.env.RSC_HOST_CALL_SECRET;
    process.env.NODE_ENV = "development";

    expect(() => assertSigningSecret()).not.toThrow();
    expect(await sign("team:1:repos")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("configured in one copy of the module is the key every copy signs with", async () => {
    configureChanged({ secret: "from-the-app" });
    const here = await sign("team:1:repos");

    // A second copy, as an app's own import of the package would be.
    const other = (await import(
      "../../src/changed.ts?copy=" + Date.now()
    )) as typeof import("../../src/changed");

    expect(await other.sign("team:1:repos")).toBe(here);
  });
});

// ── Versions in a table ──────────────────────────────────────────────────────

describe("versions in a table every instance shares", () => {
  const database = () => {
    const db = new Database(":memory:");

    db.run(
      "CREATE TABLE rsc_versions (name TEXT PRIMARY KEY, version BIGINT NOT NULL)",
    );

    return db;
  };
  const over = (db: Database, extra: Partial<SqlVersionsOptions> = {}) =>
    sqlVersions({
      query: async (text, params) =>
        db.query(text).all(...(params as string[])) as Record<
          string,
          unknown
        >[],
      ...extra,
    });

  test("a name nobody changed is at 0; a change moves it, once per call", async () => {
    const source = over(database());

    expect(await source.changed({ orders: -1 }, 0)).toEqual({ orders: 0 });
    await source.bump(["orders", "orders"]);
    const first = await at(source, "orders");
    await source.bump(["orders"]);

    expect(await source.changed({ orders: 0, stock: 0 }, 0)).toEqual({
      orders: moved,
    });
    expect(await at(source, "orders")).toBeGreaterThan(first);
  });

  test("a worker's change is read by the web server: two sources, one table", async () => {
    const db = database();
    const web = over(db, { poll: 20 });
    const worker = over(db);

    setTimeout(() => void worker.bump(["restoration:42"]), 30);

    const started = Date.now();

    expect(await web.changed({ "restoration:42": 0 }, 2_000)).toEqual({
      "restoration:42": moved,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("with LISTEN and NOTIFY, a waiting ask hears another instance at once, not on the next poll", async () => {
    const db = database();
    const channel = new Set<() => void>();
    const listen = (wake: () => void) => channel.add(wake);
    const notify = () => {
      for (const wake of channel) wake();
    };
    const web = over(db, { poll: 60_000, listen, notify });
    const worker = over(db, { listen, notify });

    setTimeout(() => void worker.bump(["restoration:42"]), 30);

    const started = Date.now();

    expect(await web.changed({ "restoration:42": 0 }, 5_000)).toEqual({
      "restoration:42": moved,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("a waiting ask is bounded by wait", async () => {
    const source = over(database(), { poll: 20 });
    const started = Date.now();

    expect(await source.changed({ orders: 0 }, 120)).toEqual({});
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  test("changed() bumps whatever source the app installed", async () => {
    const db = database();

    installVersionSource(over(db));
    await changed("orders");

    expect(
      db.query("SELECT version FROM rsc_versions WHERE name = ?").get("orders"),
    ).toEqual({ version: moved });
  });
});

// ── The server ───────────────────────────────────────────────────────────────

describe("a server for an app that uses refreshOn", () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const name of [
      "RSC_SIGNING_SECRET",
      "RSC_HOST_CALL_SECRET",
      "NODE_ENV",
    ]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  const handler = (refreshOn: boolean) =>
    createRscHandler({
      engine: {
        manifest: () => ({
          version: 1,
          build: { refreshOn },
          routes: [],
          intercepts: [],
          apis: [],
        }),
        installHostFn: () => {},
        handleRscStream: async () => ({
          stream: new Response("").body!,
          segmentDepth: 0,
        }),
        handleRscHtmlStream: async () => ({
          htmlStream: new Response("").body!,
        }),
      },
    } as never);

  test("refuses to serve in production without a signing secret, saying what to set", async () => {
    configureChanged({ secret: null });
    delete process.env.RSC_SIGNING_SECRET;
    delete process.env.RSC_HOST_CALL_SECRET;
    process.env.NODE_ENV = "production";

    await expect(
      handler(true)(new Request("https://app.test/")),
    ).rejects.toThrow("RSC_SIGNING_SECRET");
  });

  test("an app that does not use it is not asked for one", async () => {
    configureChanged({ secret: null });
    delete process.env.RSC_SIGNING_SECRET;
    delete process.env.RSC_HOST_CALL_SECRET;
    process.env.NODE_ENV = "production";

    expect(
      await handler(false)(new Request("https://app.test/")),
    ).not.toBeInstanceOf(Error);
  });
});

describe("versions in Postgres", () => {
  // A stand-in for one Postgres database, shared by the clients made from it:
  // it answers the store's read, applies its upsert, and delivers its NOTIFY
  // to every listener - what a real server does with these two statements.
  // The statements themselves are run against a real Postgres separately.
  const database = () => {
    const versions = new Map<string, number>();
    const listeners = new Set<() => void>();

    return () => ({
      unsafe: async (text: string, params: unknown[] = []) => {
        if (text.startsWith("SELECT name, version")) {
          return (params as string[]).filter((n) => versions.has(n)).map((name) => ({ name, version: String(versions.get(name)) }));
        }

        const [now, ...rest] = params as [number, ...string[]];
        const names = text.includes("pg_notify") ? rest.slice(0, -1) : rest;

        for (const name of names) versions.set(name, Math.max((versions.get(name) ?? 0) + 1, now));
        if (text.includes("pg_notify")) for (const wake of listeners) wake();

        return [];
      },
      listen: (_channel: string, wake: () => void) => listeners.add(wake),
    });
  };

  test("is one line", async () => {
    const source = postgresVersions(database()());

    await source.bump(["orders"]);
    expect(await source.changed({ orders: 0 }, 0)).toEqual({ orders: moved });
  });

  test("with a client that can LISTEN, another instance's change wakes a waiting ask at once", async () => {
    const connect = database();
    const web = postgresVersions(connect(), { poll: 60_000 });
    const worker = postgresVersions(connect());

    setTimeout(() => void worker.bump(["restoration:42"]), 30);

    const started = Date.now();

    expect(await web.changed({ "restoration:42": 0 }, 5_000)).toEqual({ "restoration:42": moved });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("versions in any store: the app's adapter, rsc-kit's waiting", () => {
  // Redis's shape: MGET, INCR, and a pub/sub channel the instances share.
  const redis = () => {
    const keys = new Map<string, number>();
    const subscribers = new Set<() => void>();

    return {
      mget: async (...ks: string[]) =>
        ks.map((k) => (keys.has(k) ? String(keys.get(k)) : null)),
      incr: async (k: string) => keys.set(k, (keys.get(k) ?? 0) + 1).get(k)!,
      subscribe: (fn: () => void) => subscribers.add(fn),
      publish: () => {
        for (const fn of subscribers) fn();
      },
    };
  };
  const overRedis = (r: ReturnType<typeof redis>, poll = 60_000) =>
    createVersions(
      {
        read: async (names) => {
          const values = await r.mget(...names.map((n) => "rsc:" + n));

          return Object.fromEntries(
            names.map((n, i) => [n, Number(values[i] ?? 0)]),
          );
        },
        bump: async (names) => {
          await Promise.all(names.map((n) => r.incr("rsc:" + n)));
        },
        listen: (wake) => r.subscribe(wake),
        notify: () => r.publish(),
      },
      { poll },
    );

  test("Redis: another instance's change wakes a waiting ask through pub/sub", async () => {
    const r = redis();
    const web = overRedis(r);
    const worker = overRedis(r);

    setTimeout(() => void worker.bump(["restoration:42"]), 30);

    const started = Date.now();

    expect(await web.changed({ "restoration:42": 0 }, 5_000)).toEqual({
      "restoration:42": moved,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("a store that leaves out a name it never saw: that name is at 0", async () => {
    const source = createVersions({
      read: async () => ({}),
      bump: async () => {},
    });

    expect(await source.changed({ never: -1 }, 0)).toEqual({ never: 0 });
  });

  test("a name bumped twice in one call moves once", async () => {
    const seen: string[][] = [];
    const source = createVersions({
      read: async () => ({}),
      bump: async (names) => void seen.push(names),
    });

    await source.bump(["a", "a", "b"]);
    expect(seen).toEqual([["a", "b"]]);
  });

  test("Prisma: its raw queries are sqlVersions' query", async () => {
    const db = new Database(":memory:");

    db.run(
      "CREATE TABLE rsc_versions (name TEXT PRIMARY KEY, version BIGINT NOT NULL)",
    );

    // Prisma's shape: $queryRawUnsafe(text, ...params).
    const prisma = {
      $queryRawUnsafe: async (text: string, ...params: unknown[]) =>
        db
          .query(text.replace(/\$\d+/g, "?"))
          .all(...(params as string[])) as Record<string, unknown>[],
    };
    const source = sqlVersions({
      query: (text, params) => prisma.$queryRawUnsafe(text, ...params),
      placeholder: (n) => "$" + n,
    });

    await source.bump(["orders"]);
    expect(await source.changed({ orders: 0 }, 0)).toEqual({ orders: moved });
  });
});

describe("whose versions", () => {
  afterEach(() => {
    installVersionSource(null);
    installBackendVersionSource(null);
  });

  test("the app's store wins over the backend's: read here, watching costs the backend nothing", async () => {
    const backend = memoryVersions();
    const app = memoryVersions();

    installBackendVersionSource(backend);
    installVersionSource(app);
    await changed("orders");

    expect(await app.changed({ orders: 0 }, 0)).toEqual({ orders: moved });
    expect(await backend.changed({ orders: 0 }, 0)).toEqual({});
  });

  test("without one, the backend's; without either, this process's", async () => {
    const backend = memoryVersions();

    installBackendVersionSource(backend);
    expect(versionSource()).toBe(backend);

    installBackendVersionSource(null);
    expect(versionSource()).not.toBe(backend);
  });
});

describe("a store installed where a build also runs", () => {
  test("does not listen - open a connection - until an ask waits", async () => {
    let listened = 0;
    const source = createVersions({
      read: async () => ({}),
      bump: async () => {},
      listen: () => void listened++,
    });

    // Created, installed, read at render, bumped: none of that is a watcher.
    await source.changed({ a: -1 }, 0);
    await source.bump(["a"]);
    expect(listened).toBe(0);

    // A server with a tab watching waits.
    await source.changed({ a: 0 }, 10);
    await source.changed({ a: 0 }, 10);
    expect(listened).toBe(1);
  });

  test("a listen that fails is tried again, backing off", async () => {
    let tries = 0;
    const source = createVersions({
      read: async () => ({}),
      bump: async () => {},
      listen: async () => {
        tries++;
        if (tries === 1) throw new Error("connection refused");
      },
    });

    await source.changed({ a: 0 }, 10);
    await new Promise((r) => setTimeout(r, 5));
    expect(tries).toBe(1);

    // Tried again on its own, after a second's backoff.
    await new Promise((r) => setTimeout(r, 1_100));
    expect(tries).toBe(2);
  });
});

describe("versions kept in this process only, in production", () => {
  const saved = process.env.NODE_ENV;
  let warnings: string[] = [];
  const warn = console.warn;

  beforeEach(() => {
    installVersionSource(null);
    installBackendVersionSource(null);
    resetChanges();
    warnings = [];
    console.warn = (message: string) => void warnings.push(message);
  });

  afterEach(() => {
    console.warn = warn;
    process.env.NODE_ENV = saved;
  });

  test("are said to be, once, since several instances would not see each other's changes", async () => {
    process.env.NODE_ENV = "production";

    await changed("orders");
    await versionSource().changed({ orders: 0 }, 0);

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("this process only");
    // Every kind of store, not one database: an app on MySQL reads it too.
    for (const store of ["sqlVersions", "postgresVersions", "createVersions", "memoryVersions"]) {
      expect(warnings[0]).toContain(store);
    }
  });

  test("are not, when the app chose them for a single instance", async () => {
    process.env.NODE_ENV = "production";
    installVersionSource(memoryVersions());

    await changed("orders");
    expect(warnings).toEqual([]);
  });

  test("are not, when a backend keeps the versions", async () => {
    process.env.NODE_ENV = "production";
    installBackendVersionSource(memoryVersions());

    await changed("orders");
    expect(warnings).toEqual([]);
  });

  test("are not, in development", async () => {
    process.env.NODE_ENV = "development";

    await changed("orders");
    expect(warnings).toEqual([]);
  });
});

describe("cleaning up", () => {
  test("a SQL store prunes names not changed in a while, and a pruned name comes back at a new version", async () => {
    const db = new Database(":memory:");

    db.run("CREATE TABLE rsc_versions (name TEXT PRIMARY KEY, version BIGINT NOT NULL)");

    const source = sqlVersions({
      query: async (text, params) => db.query(text).all(...(params as string[])) as Record<string, unknown>[],
    });

    // A name that last moved a year ago, and a tab that has held it since.
    const held = Date.now() - 365 * 24 * 60 * 60 * 1000;

    db.run("INSERT INTO rsc_versions VALUES ('old', ?)", [held]);
    await source.bump(["fresh"]);
    await source.prune();

    expect(db.query("SELECT name FROM rsc_versions ORDER BY name").all()).toEqual([{ name: "fresh" }]);

    // Pruned, it reads as 0 - different from what the tab holds, so the tab
    // refreshes once - and changed again it comes back past it, never at it.
    expect(await source.changed({ old: held }, 0)).toEqual({ old: 0 });

    await source.bump(["old"]);
    expect(await at(source, "old")).toBeGreaterThan(held);
  });

  test("a bump through SQL is the larger of one more and now: a counter row written by an older writer moves to the time", async () => {
    const db = new Database(":memory:");

    db.run("CREATE TABLE rsc_versions (name TEXT PRIMARY KEY, version BIGINT NOT NULL)");
    db.run("INSERT INTO rsc_versions VALUES ('counted', 7)");

    const source = sqlVersions({
      query: async (text, params) => db.query(text).all(...(params as string[])) as Record<string, unknown>[],
    });
    const before = Date.now();

    await source.bump(["counted"]);
    expect(await at(source, "counted")).toBeGreaterThanOrEqual(before);
  });

  test("the server forgets a name when the last tab watching it closes", async () => {
    const opened = await Promise.all(
      ["a", "b"].map(async (name) => {
        const controller = new AbortController();
        const response = await changes(
          new Request(
            "https://app.test/_rsc/changes?w=" + encodeURIComponent(JSON.stringify([[name, 0, await sign(name)]])),
            { signal: controller.signal },
          ),
        );

        return { controller, response };
      }),
    );

    expect(rememberedNames()).toBe(2);

    opened[0]!.controller.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(rememberedNames()).toBe(1);

    opened[1]!.controller.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(rememberedNames()).toBe(0);

    for (const { response } of opened) await response.body?.cancel().catch(() => {});
  });
});

describe("a store that listens", () => {
  test("reads on a wake, not every second: the timer is only a safety net", async () => {
    let reads = 0;
    const wakes = new Set<() => void>();
    const source = createVersions({
      read: async () => {
        reads++;
        return {};
      },
      bump: async () => {},
      listen: (wake) => wakes.add(wake),
    });

    // A one-and-a-half-second wait with nothing moving: a read as it starts
    // and the safety-net read as it ends - none in between.
    await source.changed({ a: 0 }, 1_500);
    expect(reads).toBe(2);
  });

  test("a store that cannot listen reads every second while it waits", async () => {
    let reads = 0;
    const source = createVersions({
      read: async () => {
        reads++;
        return {};
      },
      bump: async () => {},
    });

    await source.changed({ a: 0 }, 1_500);
    expect(reads).toBeGreaterThanOrEqual(3);
  });
});

describe("one statement per change, in the database's own dialect", () => {
  test("SQLite: every name moves in one upsert, to the time, past an older counter", async () => {
    const db = new Database(":memory:");

    db.run("CREATE TABLE rsc_versions (name TEXT PRIMARY KEY, version BIGINT NOT NULL)");
    db.run("INSERT INTO rsc_versions VALUES ('counted', 7)");

    const queries: string[] = [];
    const source = sqlVersions({
      dialect: "sqlite",
      query: async (text, params) => {
        queries.push(text);
        return db.query(text).all(...(params as string[])) as Record<string, unknown>[];
      },
    });
    const before = Date.now();

    await source.bump(["counted", "fresh"]);
    expect(queries.length).toBe(1);
    expect(queries[0]).toContain("ON CONFLICT (name) DO UPDATE");

    const first = await at(source, "fresh");

    expect(await at(source, "counted")).toBeGreaterThanOrEqual(before);
    expect(first).toBeGreaterThanOrEqual(before);

    await source.bump(["fresh"]);
    expect(await at(source, "fresh")).toBeGreaterThan(first);
  });

  test("Postgres: one statement, the NOTIFY in it, the names as parameters", async () => {
    const sent: [string, unknown[]][] = [];
    const source = postgresVersions({
      unsafe: async (text: string, params: unknown[] = []) => {
        sent.push([text, params]);
        return [];
      },
    });

    await source.bump(["conversation:42", "inbox:7"]);

    expect(sent.length).toBe(1);

    const [text, params] = sent[0]!;

    expect(text).toContain("ON CONFLICT (name) DO UPDATE SET version = GREATEST(rsc_versions.version + 1, EXCLUDED.version)");
    expect(text).toContain("pg_notify($4, '')");
    expect(params.slice(1)).toEqual(["conversation:42", "inbox:7", "rsc_versions"]);
    // Names travel as parameters, never in the SQL.
    expect(text).not.toContain("conversation:42");
  });
});
