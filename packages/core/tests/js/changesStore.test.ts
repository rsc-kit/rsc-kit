import { registerDom } from "./dom";

registerDom();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { register, resetChanges } from "../../src/js/changesStore";

/**
 * The tab's side of names: one stream for everything the page registered,
 * and a version that moved refreshing exactly the regions holding its name.
 */

class FakeSource {
  static instances: FakeSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeSource.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  fail() {
    this.readyState = 2;
    this.onerror?.(new Event("error"));
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  /** What the tab asked to watch. */
  get watched(): [string, number, string][] {
    return JSON.parse(decodeURIComponent(this.url.split("?w=")[1])) as [
      string,
      number,
      string,
    ][];
  }
}

let refreshed: string[] = [];
let asked: string[] = [];
const settle = () => new Promise((r) => setTimeout(r, 40));

beforeEach(() => {
  FakeSource.instances = [];
  refreshed = [];
  asked = [];
  (globalThis as { EventSource?: unknown }).EventSource = FakeSource;
  (
    window as unknown as {
      __rsc_refresh: (t: string, c?: string) => Promise<void>;
    }
  ).__rsc_refresh = async (target, changedBy) => {
    refreshed.push(target);
    if (changedBy) asked.push(target + " " + changedBy);
  };
});

afterEach(() => {
  resetChanges();
  delete (globalThis as { EventSource?: unknown }).EventSource;
});

describe("watching", () => {
  test("opens one stream for every region's names, at the lowest version held", async () => {
    register({ target: "repos", names: { "team:1:repos": [3, "sig-a"] } });
    register({
      target: "members",
      names: { "team:1:members": [1, "sig-b"], "team:1:repos": [2, "sig-a"] },
    });
    await settle();

    expect(FakeSource.instances.length).toBe(1);
    expect(FakeSource.instances[0].url.startsWith("/_rsc/changes?w=")).toBe(
      true,
    );
    expect(FakeSource.instances[0].watched).toEqual([
      ["team:1:members", 1, "sig-b"],
      ["team:1:repos", 2, "sig-a"],
    ]);
  });

  test("a version that moved refreshes the regions on its name, once, and not the rest", async () => {
    register({ target: "repos", names: { "team:1:repos": [3, "a"] } });
    register({ target: "members", names: { "team:1:members": [1, "b"] } });
    register({
      target: "activity",
      names: { "team:1:repos": [3, "a"], "team:1:members": [1, "b"] },
    });
    await settle();

    FakeSource.instances[0].send({ name: "team:1:repos", version: 4 });
    await settle();

    expect(refreshed.sort()).toEqual(["activity", "repos"]);

    // The same version again is nothing new.
    FakeSource.instances[0].send({ name: "team:1:repos", version: 4 });
    await settle();
    expect(refreshed.length).toBe(2);
  });

  test("the page refreshing covers its sections, so only the page is asked for", async () => {
    register({ target: "page", names: { "team:1": [0, "p"] } });
    register({ target: "repos", names: { "team:1": [0, "p"] } });
    await settle();

    FakeSource.instances[0].send({ name: "team:1", version: 1 });
    await settle();

    expect(refreshed).toEqual(["page"]);
  });

  test("a region re-registering at a new version does not reopen the stream for nothing; a new name does", async () => {
    const forget = register({
      target: "repos",
      names: { "team:1:repos": [3, "a"] },
    });
    await settle();
    expect(FakeSource.instances.length).toBe(1);

    // Re-rendered after a refresh: same names, same stream.
    forget();
    register({ target: "repos", names: { "team:1:repos": [3, "a"] } });
    await settle();
    expect(FakeSource.instances.length).toBe(1);

    register({ target: "members", names: { "team:1:members": [0, "b"] } });
    await settle();
    expect(FakeSource.instances.length).toBe(2);
    expect(FakeSource.instances[0].closed).toBe(true);
  });

  test("closes when nothing is registered, and while the tab is hidden", async () => {
    const forget = register({
      target: "repos",
      names: { "team:1:repos": [3, "a"] },
    });
    await settle();

    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(FakeSource.instances[0].closed).toBe(true);

    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(FakeSource.instances.length).toBe(2);

    forget();
    await settle();
    expect(FakeSource.instances[1].closed).toBe(true);
  });

  test("after the browser gives up it tries again with backoff, and stops after three failures", async () => {
    register({ target: "repos", names: { "team:1:repos": [3, "a"] } });
    await settle();

    FakeSource.instances[0].fail();
    await new Promise((r) => setTimeout(r, 1_100));
    expect(FakeSource.instances.length).toBe(2);

    FakeSource.instances[1].fail();
    FakeSource.instances[1].readyState = 2;
    await new Promise((r) => setTimeout(r, 2_100));
    expect(FakeSource.instances.length).toBe(3);

    FakeSource.instances[2].fail();
    await new Promise((r) => setTimeout(r, 4_100));
    expect(FakeSource.instances.length).toBe(4);

    // The fourth failure is the last: names signed by another deploy will not
    // verify until something re-renders.
    FakeSource.instances[3].fail();
    await new Promise((r) => setTimeout(r, 1_100));
    expect(FakeSource.instances.length).toBe(4);
  }, 15_000);

  test("a refresh a change triggered says which change, so tabs asking about the same one can share a render", async () => {
    register({
      target: "repos",
      names: { "team:1:repos": [3, "a"], "team:1:members": [1, "b"] },
    });
    await settle();

    FakeSource.instances[0].send({ name: "team:1:repos", version: 4 });
    FakeSource.instances[0].send({ name: "team:1:members", version: 2 });
    await settle();

    // Both changes in one tick: one refresh, naming both, in a stable order.
    expect(asked).toEqual(["repos team:1:members@2,team:1:repos@4"]);
  });
});
