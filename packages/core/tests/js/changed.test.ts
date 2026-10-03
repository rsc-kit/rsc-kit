/**
 * Names on the server: versions, where they come from, the signed names a tab
 * is handed, and the stream it watches them on.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  backendVersions,
  changed,
  configureChanged,
  installVersionSource,
  memoryVersions,
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

describe("versions kept in this process", () => {
  test("a name nobody changed is at 0; a change moves it; only what differs is answered", async () => {
    const source = memoryVersions();

    expect(await source.changed({ a: -1, b: -1 }, 0)).toEqual({ a: 0, b: 0 });
    expect(await source.changed({ a: 0, b: 0 }, 0)).toEqual({});

    source.bump(["a"]);

    expect(await source.changed({ a: 0, b: 0 }, 0)).toEqual({ a: 1 });
  });

  test("waits for a change, and no longer than asked", async () => {
    const source = memoryVersions();
    const started = Date.now();
    const waited = source.changed({ a: 0 }, 5_000);

    setTimeout(() => source.bump(["a"]), 30);

    expect(await waited).toEqual({ a: 1 });
    expect(Date.now() - started).toBeLessThan(1_000);

    const bounded = Date.now();

    expect(await source.changed({ a: 1 }, 50)).toEqual({});
    expect(Date.now() - bounded).toBeGreaterThanOrEqual(45);
  });

  test("changed() bumps the installed source", async () => {
    await changed("orders", "orders");

    expect(await versionSource().changed({ orders: 0 }, 0)).toEqual({
      orders: 2,
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
    expect(await source.changed({ a: 0 }, 0)).toEqual({ a: 1 });
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

    expect(text).toContain('data: {"name":"orders","version":1}');
  });

  test("reports a change that happened between the render and the stream opening", async () => {
    // The page was rendered with orders at 0; by the time the tab connects it
    // has moved. Nothing in that gap may be missed.
    await changed("orders");

    const response = await watching([["orders", 0]]);
    const text = await read(response, (t) => t.includes('"orders"'));

    expect(text).toContain('{"name":"orders","version":1}');
  });

  test("a tab already at the current version hears nothing until it moves again", async () => {
    await changed("orders");

    const response = await watching([["orders", 1]]);
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

    expect(a).toContain('{"name":"orders","version":1}');
    expect(b).toContain('{"name":"orders","version":1}');

    // Every ask the loop made covered both tabs' names at once.
    const shared = asks.filter(
      (since) => "stock" in since && "orders" in since,
    );

    expect(shared.length).toBeGreaterThan(0);
  });
});
