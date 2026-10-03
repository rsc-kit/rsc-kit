/**
 * Tags on the server: versions, where they come from, the signed tags a tab
 * is handed, and the stream it watches them on.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  backendTags,
  changed,
  configureTags,
  installTagSource,
  memoryTags,
  resetWatching,
  sign,
  tagSource,
  watch,
} from "../../src/tags";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("tags.test.ts");

beforeEach(() => {
  installTagSource(null);
  resetWatching();
  configureTags({ secret: "test-secret" });
});

afterEach(() => {
  installTagSource(null);
  resetWatching();
  configureTags({ secret: null });
});

describe("versions kept in this process", () => {
  test("a tag nobody changed is at 0; a change moves it; only what differs is answered", async () => {
    const source = memoryTags();

    expect(await source.changed({ a: -1, b: -1 }, 0)).toEqual({ a: 0, b: 0 });
    expect(await source.changed({ a: 0, b: 0 }, 0)).toEqual({});

    source.bump(["a"]);

    expect(await source.changed({ a: 0, b: 0 }, 0)).toEqual({ a: 1 });
  });

  test("waits for a change, and no longer than asked", async () => {
    const source = memoryTags();
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

    expect(await tagSource().changed({ orders: 0 }, 0)).toEqual({ orders: 2 });
  });
});

describe("versions kept by a backend", () => {
  test("are asked through __rsc.tags with what is held and how long to wait", async () => {
    const asked: unknown[] = [];
    const source = backendTags(async (name, ...args) => {
      asked.push([name, ...args]);

      return { versions: { a: 7 } };
    });

    expect(await source.changed({ a: 0 }, 1_500)).toEqual({ a: 7 });
    expect(asked).toEqual([["__rsc.tags", { since: { a: 0 }, wait: 1_500 }]]);
  });

  test("a backend without the function is answered from this process instead, from then on", async () => {
    let calls = 0;
    const source = backendTags(async () => {
      calls++;
      throw new Error(
        'Host call "__rsc.tags" failed: No host function named "__rsc.tags".',
      );
    });

    expect(await source.changed({ a: -1 }, 0)).toEqual({ a: 0 });
    await source.bump(["a"]);
    expect(await source.changed({ a: 0 }, 0)).toEqual({ a: 1 });
    expect(calls).toBe(1);
  });

  test("any other failure is the caller's, and changed() is refused: the versions are the backend's", async () => {
    const source = backendTags(async () => {
      throw new Error('Host call "__rsc.tags" could not reach the host');
    });

    await expect(source.changed({ a: 0 }, 0)).rejects.toThrow(
      "could not reach",
    );
    expect(() => source.bump(["a"])).toThrow("rsckit.Changed");
  });
});

describe("signed tags", () => {
  test("are stable for a secret, differ by tag and by secret, and are short", async () => {
    const a = await sign("team:1:repos");

    expect(await sign("team:1:repos")).toBe(a);
    expect(await sign("team:2:repos")).not.toBe(a);
    expect(a.length).toBeLessThanOrEqual(24);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);

    configureTags({ secret: "another" });
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
    entries.map(async ([tag, version]) => [tag, version, await sign(tag)]),
  );

  return watch(
    new Request(
      "https://app.test/_rsc/watch?w=" +
        encodeURIComponent(JSON.stringify(signed)),
    ),
  );
};

describe("the watch stream", () => {
  test("refuses a tag not signed for this app, and a malformed request", async () => {
    const forged = await watch(
      new Request(
        "https://app.test/_rsc/watch?w=" +
          encodeURIComponent(JSON.stringify([["secret:tag", 0, "nope"]])),
      ),
    );

    expect(forged.status).toBe(403);
    expect(
      (await watch(new Request("https://app.test/_rsc/watch"))).status,
    ).toBe(400);
    expect(
      (await watch(new Request("https://app.test/_rsc/watch?w=notjson")))
        .status,
    ).toBe(400);
  });

  test("is an event stream that reports a tag the moment it moves", async () => {
    const response = await watching([["orders", 0]]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    setTimeout(() => void changed("orders"), 30);

    const text = await read(response, (t) => t.includes('"orders"'));

    expect(text).toContain('data: {"tag":"orders","version":1}');
  });

  test("reports a change that happened between the render and the stream opening", async () => {
    // The page was rendered with orders at 0; by the time the tab connects it
    // has moved. Nothing in that gap may be missed.
    await changed("orders");

    const response = await watching([["orders", 0]]);
    const text = await read(response, (t) => t.includes('"orders"'));

    expect(text).toContain('{"tag":"orders","version":1}');
  });

  test("a tab already at the current version hears nothing until it moves again", async () => {
    await changed("orders");

    const response = await watching([["orders", 1]]);
    const quiet = await read(response, (t) => t.includes("data:"), 400);

    expect(quiet).not.toContain("data:");
  });

  test("two tabs share one ask, and both hear the change", async () => {
    const asks: Record<string, number>[] = [];
    const inner = memoryTags();

    installTagSource({
      changed: (since, wait) => {
        asks.push(since);

        return inner.changed(since, wait);
      },
      bump: (tags) => inner.bump(tags),
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

    expect(a).toContain('{"tag":"orders","version":1}');
    expect(b).toContain('{"tag":"orders","version":1}');

    // Every ask the loop made covered both tabs' tags at once.
    const shared = asks.filter(
      (since) => "stock" in since && "orders" in since,
    );

    expect(shared.length).toBeGreaterThan(0);
  });
});
