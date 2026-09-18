import { describe, expect, test } from "bun:test";

import { viewTransitionClass } from "../../src/vite.js";

/**
 * The navigation's view transition carries a class so the app's CSS can
 * shape or silence the browser's default cross-fade. `true` gets the default
 * name; an object names it; anything else is no boundary at all.
 */
describe("the class a navigation transition carries", () => {
  test("true is the default name", () => {
    expect(viewTransitionClass(true)).toBe("rsc-navigation");
  });

  test("an object names it, and an empty name falls back", () => {
    expect(viewTransitionClass({ className: "nav" })).toBe("nav");
    expect(viewTransitionClass({})).toBe("rsc-navigation");
    expect(viewTransitionClass({ className: "  " })).toBe("rsc-navigation");
  });

  test("off, or unset, is no boundary", () => {
    expect(viewTransitionClass(false)).toBe(false);
    expect(viewTransitionClass(undefined)).toBe(false);
  });
});
