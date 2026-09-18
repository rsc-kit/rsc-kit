import { describe, expect, test } from "bun:test";

import {
  NAVIGATION_TRANSITION_TYPE,
  navigationTransitionClasses,
} from "../../src/js/SegmentBoundary";

/**
 * The boundary's transition props never change. React measures a boundary
 * with the props of the render before, and a prop that flipped from "none"
 * to the class on the first navigation left that navigation unmeasured:
 * React hid the root's group, and the viewport went dark until the fade
 * ended. The class rides on the transition type a navigation adds instead.
 */
describe("the classes a navigation's boundary carries", () => {
  test("apply to the navigation type and to nothing else", () => {
    expect(navigationTransitionClasses("rsc-navigation")).toEqual({
      [NAVIGATION_TRANSITION_TYPE]: "rsc-navigation",
      default: "none",
    });
  });

  test("are the same shape for any class the build chose", () => {
    expect(navigationTransitionClasses("page")).toEqual({
      "rsc-navigation": "page",
      default: "none",
    });
  });
});
