import { registerDom } from "./dom";

registerDom();

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useEvents } from "../../src/js/useEvents";
import { usePolling } from "../../src/js/usePolling";

/**
 * Live data as state: a stream of events, or a value read again on an
 * interval. Both hand every value to a store that already holds it.
 */

// A stand-in for the browser's EventSource that the test can drive.
class FakeSource {
  static instances: FakeSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  named = new Map<string, (e: { data: string }) => void>();
  closed = false;

  constructor(public url: string) {
    FakeSource.instances.push(this);
  }

  addEventListener(name: string, fn: (e: { data: string }) => void) {
    this.named.set(name, fn);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: unknown, event?: string) {
    const e = { data: JSON.stringify(data) };

    if (event) this.named.get(event)?.(e);
    else this.onmessage?.(e);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

let container: HTMLElement;

beforeEach(() => {
  FakeSource.instances = [];
  (globalThis as { EventSource?: unknown }).EventSource = FakeSource;
  container = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
  container.remove();
  delete (globalThis as { EventSource?: unknown }).EventSource;
});

describe("useEvents", () => {
  test("hands every message to the store, and keeps the latest as state", async () => {
    const seen: unknown[] = [];
    let state: ReturnType<typeof useEvents> | null = null;

    function Watch() {
      state = useEvents<{ tick: number }>("/api/ticks", {
        onMessage: (m) => seen.push(m),
      });

      return createElement("p", null, state.status);
    }

    const root = createRoot(container);

    await act(async () => root.render(createElement(Watch)));

    expect(FakeSource.instances[0].url).toBe("/api/ticks");
    expect(container.textContent).toBe("connecting");

    await act(async () => FakeSource.instances[0].open());
    expect(container.textContent).toBe("open");

    await act(async () => FakeSource.instances[0].send({ tick: 1 }));
    await act(async () => FakeSource.instances[0].send({ tick: 2 }));

    expect(seen).toEqual([{ tick: 1 }, { tick: 2 }]);
    expect(state!.latest).toEqual({ tick: 2 });
    expect(state!.all).toEqual([{ tick: 1 }, { tick: 2 }]);

    await act(async () => root.unmount());
    expect(FakeSource.instances[0].closed).toBe(true);
  });

  test("listens to one named event when asked, and does not connect when disabled", async () => {
    let done: unknown = null;

    function Watch({ enabled }: { enabled: boolean }) {
      const { latest } = useEvents<{ total: number }>("/api/ticks", {
        event: "done",
        enabled,
      });

      done = latest;

      return null;
    }

    const root = createRoot(container);

    await act(async () =>
      root.render(createElement(Watch, { enabled: false })),
    );
    expect(FakeSource.instances.length).toBe(0);

    await act(async () => root.render(createElement(Watch, { enabled: true })));
    expect(FakeSource.instances.length).toBe(1);

    await act(async () => FakeSource.instances[0].send({ tick: 1 }));
    expect(done).toBeNull(); // the unnamed stream is not what it listens to

    await act(async () => FakeSource.instances[0].send({ total: 3 }, "done"));
    expect(done).toEqual({ total: 3 });
  });
});

describe("usePolling", () => {
  test("reads at once, then on the interval, never two at a time", async () => {
    // The second read hangs. However many intervals fire while it does, no
    // third read may start - the property, not a count against the clock.
    let reads = 0;
    let resolveSlow: ((v: number) => void) | null = null;
    const seen: number[] = [];
    const read = () =>
      new Promise<number>((resolve) => {
        reads++;
        if (reads === 2) resolveSlow = resolve;
        else resolve(reads);
      });
    let state: ReturnType<typeof usePolling<number>> | null = null;

    function Poll() {
      state = usePolling(read, { every: 10, whenHidden: true, onData: (v) => seen.push(v) });

      return createElement("p", null, String(state.data));
    }

    const root = createRoot(container);

    await act(async () => root.render(createElement(Poll)));
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(container.textContent).toBe("1");

    // Wait until the hanging read has started, then let several intervals go by.
    for (let i = 0; i < 20 && reads < 2; i++)
      await act(async () => new Promise((r) => setTimeout(r, 5)));
    await act(async () => new Promise((r) => setTimeout(r, 60)));
    expect(reads).toBe(2);

    // The slow answer arrives. Not asserted on the screen: under load an
    // interval can fire inside act() and a third read land before the
    // assertion, which is polling doing its job, not a failure.
    await act(async () => resolveSlow!(42));
    expect(seen).toContain(42);

    await act(async () => root.unmount());
  });

  test("refresh() reads now, and onData sees every answer", async () => {
    let n = 0;
    const seen: number[] = [];
    let state: ReturnType<typeof usePolling<number>> | null = null;

    function Poll() {
      state = usePolling(async () => ++n, {
        every: 10_000,
        whenHidden: true,
        onData: (d) => seen.push(d),
      });

      return null;
    }

    const root = createRoot(container);

    await act(async () => root.render(createElement(Poll)));
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    await act(async () => state!.refresh());

    expect(seen).toEqual([1, 2]);
    expect(state!.data).toBe(2);

    await act(async () => root.unmount());
  });
});

describe("usePolling, until it settles", () => {
  test("stops on the read `until` accepts, and fires onSettled once", async () => {
    // A job: queued, running, done - then nothing should be read again.
    const states = ["queued", "running", "done", "done", "done"];
    let reads = 0;
    const settledWith: string[] = [];
    let state: ReturnType<typeof usePolling<string>> | null = null;

    function Poll() {
      state = usePolling(
        async () => states[Math.min(reads++, states.length - 1)],
        {
          every: 10,
          whenHidden: true,
          until: (s) => s === "done",
          onSettled: (s) => settledWith.push(s),
        },
      );

      return createElement("p", null, state.status);
    }

    const root = createRoot(container);

    await act(async () => root.render(createElement(Poll)));
    await act(async () => new Promise((r) => setTimeout(r, 60)));

    expect(container.textContent).toBe("settled");
    expect(state!.data).toBe("done");
    expect(settledWith).toEqual(["done"]);
    expect(reads).toBe(3);

    // Still stopped a while later.
    await act(async () => new Promise((r) => setTimeout(r, 40)));
    expect(reads).toBe(3);

    // refresh() reads again - the account page's "check once more".
    await act(async () => state!.refresh());
    expect(reads).toBe(4);

    await act(async () => root.unmount());
  });

  test("without `until` it never settles", async () => {
    let state: ReturnType<typeof usePolling<number>> | null = null;
    let n = 0;

    function Poll() {
      state = usePolling(async () => ++n, { every: 10, whenHidden: true });

      return null;
    }

    const root = createRoot(container);

    await act(async () => root.render(createElement(Poll)));
    await act(async () => new Promise((r) => setTimeout(r, 35)));

    expect(n).toBeGreaterThanOrEqual(3);
    expect(state!.status).toBe("reading");

    await act(async () => root.unmount());
  });
});

describe("errors reach a callback, not only state", () => {
  test("usePolling: onError fires per failed read with the run of failures, and the next interval still reads", async () => {
    let n = 0;
    const seen: [string, number][] = [];
    let state: ReturnType<typeof usePolling<number>> | null = null;

    function Poll() {
      state = usePolling(
        async () => {
          n++;
          if (n <= 2) throw new Error(`read ${n} failed`);

          return n;
        },
        {
          every: 10,
          whenHidden: true,
          onError: (e, { failures }) => seen.push([(e as Error).message, failures]),
        },
      );

      return null;
    }

    const root = createRoot(container);

    await act(async () => root.render(createElement(Poll)));
    await act(async () => new Promise((r) => setTimeout(r, 50)));

    // Two in a row, counted as such: the third failure is what a page turns
    // into a toast where the first was a blip.
    expect(seen).toEqual([["read 1 failed", 1], ["read 2 failed", 2]]);
    expect(state!.data).toBeGreaterThanOrEqual(3); // it kept reading
    expect(state!.error).toBeNull(); // and the later success cleared the state

    await act(async () => root.unmount());
  });

  test("useEvents: onError fires when the connection fails", async () => {
    const seen: Event[] = [];

    function Watch() {
      useEvents("/api/ticks", { onError: (e) => seen.push(e) });

      return null;
    }

    const root = createRoot(container);

    await act(async () => root.render(createElement(Watch)));
    await act(async () =>
      FakeSource.instances[0].onerror?.(new Event("error")),
    );

    expect(seen.length).toBe(1);

    await act(async () => root.unmount());
  });
});
