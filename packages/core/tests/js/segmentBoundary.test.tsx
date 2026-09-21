/**
 * The boundary rendered for real.
 *
 * The store's unit tests cannot see the failure that matters most here:
 * useSyncExternalStore compares snapshots by identity, so a getSnapshot that
 * builds a fresh object reads as "changed" on every render and loops until
 * React gives up. That only shows when something actually renders it — it
 * reached the browser as a blank page and React error #185.
 */

import { registerDom } from "./dom";

registerDom();

import { act } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SegmentBoundary } from "../../src/js/SegmentBoundary";
import {
  clearSegments,
  restoreSegments,
  setSegment,
} from "../../src/js/segmentStore";
import { useState } from "react";

function Field({ label }: { label: string }) {
  const [value, setValue] = useState("");

  return (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => setValue((e.target as HTMLInputElement).value)}
    />
  );
}

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  clearSegments();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearSegments();
});

function input(label: string): HTMLInputElement | null {
  return container.querySelector(`input[aria-label="${label}"]`);
}

async function type(label: string, value: string) {
  const el = input(label)!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;

  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("rendering", () => {
  test("mounts without looping and shows the server children", async () => {
    // A fresh snapshot object per read would blow the update depth here.
    await act(async () => {
      root.render(
        <SegmentBoundary depth={1} pageKey="/a">
          <Field label="a" />
        </SegmentBoundary>,
      );
    });

    expect(input("a")).not.toBeNull();
  });

  test("renders a stored segment instead of the children", async () => {
    await act(async () => {
      root.render(
        <SegmentBoundary depth={1} pageKey="/a">
          <Field label="a" />
        </SegmentBoundary>,
      );
    });

    await act(async () => setSegment(1, "/b", <Field label="b" />));

    expect(input("b")).not.toBeNull();
  });
});

describe("taking over after hydration", () => {
  test("keeps the DOM: the seed changes state, not the shape of the tree", async () => {
    // Before, the first render showed the children bare and the seed wrapped
    // them in the retention boundary - a new element type above the page,
    // which React answers by remounting the page: blank, then content, on
    // every load. Now the wrapper is there from the first render, keyed by
    // the page, so the store taking over is a no-op for the DOM.
    //
    // Committed synchronously, so the node is read before any effect runs.
    flushSync(() => {
      root.render(
        <SegmentBoundary depth={1} pageKey="/home">
          <h1 id="title">Hello</h1>
        </SegmentBoundary>,
      );
    });

    const before = container.querySelector("#title");

    expect(before).not.toBeNull();

    // Effects run; the seed notifies; the transition commits.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.querySelector("#title")).toBe(before);
  });
});

describe("returning to a page", () => {
  test("brings back what the user had typed", async () => {
    await act(async () => {
      root.render(
        <SegmentBoundary depth={1} pageKey="/a">
          <Field label="a" />
        </SegmentBoundary>,
      );
    });

    await type("a", "half-written");

    await act(async () => setSegment(1, "/b", <Field label="b" />));
    expect(input("b")).not.toBeNull();

    await act(async () => {
      expect(restoreSegments("/a")).toBe(true);
    });

    // The page it arrived on was seeded from the server children, so it is
    // still mounted — hidden — with its state.
    expect(input("a")!.value).toBe("half-written");
  });

  test("keeps a page it navigated to, not just the one it arrived on", async () => {
    await act(async () => {
      root.render(
        <SegmentBoundary depth={1} pageKey="/a">
          <Field label="a" />
        </SegmentBoundary>,
      );
    });

    await act(async () => setSegment(1, "/b", <Field label="b" />));
    await type("b", "typed on b");
    await act(async () => setSegment(1, "/c", <Field label="c" />));

    await act(async () => {
      expect(restoreSegments("/b")).toBe(true);
    });

    expect(input("b")!.value).toBe("typed on b");
  });
});

describe("the markup a boundary leaves for hydration", () => {
  test("carries the Activity whether or not it has a page key", () => {
    // A parameterised route's PPR shell is rendered for every url it matches
    // and so has no key; the client, hydrating from the payload for the real
    // url, has one. Their markup has to agree: React 19.2 does not recover
    // from a hydration mismatch at an Activity - it retries the boundary
    // forever and the tab freezes. A port hit it on every document load of
    // /agent/tools/3.
    const keyed = renderToString(
      <SegmentBoundary depth={1} pageKey="/agent/tools/3">
        <p>page</p>
      </SegmentBoundary>,
    );
    const unkeyed = renderToString(
      <SegmentBoundary depth={1}>
        <p>page</p>
      </SegmentBoundary>,
    );

    expect(keyed).toContain("<!--&-->");
    expect(unkeyed).toBe(keyed);
  });
});
