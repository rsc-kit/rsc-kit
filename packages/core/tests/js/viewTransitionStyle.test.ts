import { registerDom } from "./dom";

registerDom();

const { describe, expect, test } = await import("bun:test");
const { installViewTransitionStyle, viewTransitionStyle } =
  await import("../../src/js/viewTransitionStyle");

/**
 * A page swap cross-fades in place: React's per-element groups keep their
 * fades and lose their movement. The root is React's to cancel - forcing it
 * on from here captured a root whose group React had hidden, and that was a
 * dark viewport on the first navigation.
 */
describe("the transition style installed with the boundary", () => {
  test("switches off the movement of the navigation's groups, nothing else", () => {
    expect(viewTransitionStyle("rsc-navigation")).toBe(
      "::view-transition-group(.rsc-navigation){animation:none}",
    );
    expect(viewTransitionStyle("page")).toContain("(.page)");
  });

  test("leaves the root and an app's own names alone", () => {
    const css = viewTransitionStyle("rsc-navigation");

    expect(css).not.toContain(":root");
    expect(css).not.toContain("_t_");
    expect(css).not.toContain("!important");
  });

  test("is installed once, and not at all when the build did not ask", () => {
    installViewTransitionStyle(null);
    expect(document.getElementById("rsc-kit-view-transition")).toBeNull();

    installViewTransitionStyle("rsc-navigation");
    installViewTransitionStyle("rsc-navigation");
    expect(document.querySelectorAll("#rsc-kit-view-transition").length).toBe(
      1,
    );
  });
});
