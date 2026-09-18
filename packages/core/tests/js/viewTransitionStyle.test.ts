import { registerDom } from "./dom";

registerDom();

const { describe, expect, test } = await import("bun:test");
const { installViewTransitionStyle, viewTransitionStyle } =
  await import("../../src/js/viewTransitionStyle");

/**
 * A page swap fades the whole viewport, like Inertia's: React's generated
 * per-element names are switched off, the root switched back on, and an
 * app's own shared-element names left alone.
 */
describe("the transition style installed with the boundary", () => {
  test("switches React's generated names off and the root on", () => {
    const css = viewTransitionStyle();

    expect(css).toContain('[style*="view-transition-name: _t_"]');
    expect(css).toContain("view-transition-name:none!important");
    expect(css).toContain(":root{view-transition-name:root!important}");
  });

  test("leaves an app's own names alone", () => {
    // Only the `_t_` prefix React generates is matched; `hero` is not.
    expect(viewTransitionStyle()).not.toMatch(
      /\[style\*="view-transition-name"\]/,
    );
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
