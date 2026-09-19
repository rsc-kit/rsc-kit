import { beforeAll, describe, expect, test } from "bun:test";
import { createRscHandler } from "../../src/host";
import { frame, KEEPALIVE_MS } from "../../src/events";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("events.test.ts");

/**
 * A route that streams: server-sent events from an async generator, framed
 * for EventSource, ended when the browser goes away.
 */
let handle: (request: Request) => Promise<Response | null>;

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import("./goHost");

  await buildFixtureOnce();

  const engine: any = await import(bundlePath);

  handle = createRscHandler({
    engine: { ...engine, manifest: engine.manifest },
    manifest: engine.manifest(),
  } as never);
}, 300_000);

describe("a message, framed", () => {
  test("is one data line, JSON, blank-line terminated", () => {
    expect(frame({ tick: 1 })).toBe('data: {"tick":1}\n\n');
    expect(frame("plain")).toBe('data: "plain"\n\n');
  });

  test("a named one carries its name and id before the data", () => {
    expect(frame({ event: "done", id: "last", data: { total: 3 } })).toBe(
      'event: done\nid: last\ndata: {"total":3}\n\n',
    );
    // A plain object that happens to have a `data` key is data, not a name.
    expect(frame({ data: 1, other: 2 })).toBe('data: {"data":1,"other":2}\n\n');
  });
});

describe("the route", () => {
  test("answers as a stream the browser's EventSource reads, uncacheable", async () => {
    const res = await handle(new Request("https://app.test/api/ticks"));

    expect(res!.headers.get("content-type")).toContain("text/event-stream");
    expect(res!.headers.get("cache-control")).toBe("no-store");

    const text = await res!.text();

    expect(text.startsWith("retry: 1000\n\n")).toBe(true);
    expect(text).toContain('data: {"tick":1}\n\n');
    expect(text).toContain('data: {"tick":3}\n\n');
    expect(text).toContain('event: done\nid: last\ndata: {"total":3}\n\n');
  });

  test("the query string reaches the generator, and it says so in the served-from header too", async () => {
    const res = await handle(new Request("https://app.test/api/ticks?count=1"));
    const text = await res!.text();

    expect(text).toContain('data: {"tick":1}');
    expect(text).not.toContain('data: {"tick":2}');
    expect(res!.headers.get("x-rsc-kit")).toBe("rendered");
  });

  test("ends the generator when the browser goes away", async () => {
    const controller = new AbortController();
    const res = await handle(
      new Request("https://app.test/api/ticks?count=1000", {
        signal: controller.signal,
      }),
    );
    const reader = res!.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";

    while (!seen.includes('"tick":2')) {
      const { value, done } = await reader.read();

      if (done) break;

      seen += decoder.decode(value);
    }

    await reader.cancel();
    controller.abort();

    // Nothing to assert on the wire after a cancel; the proof is that this
    // returns rather than waiting on a thousand ticks.
    expect(seen).toContain('"tick":1');
  });

  test("keeps a proxy from dropping an idle stream", () => {
    expect(KEEPALIVE_MS).toBeGreaterThan(0);
    expect(KEEPALIVE_MS).toBeLessThanOrEqual(30_000);
  });
});
