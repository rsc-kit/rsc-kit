import { registerDom } from "./dom";

registerDom();

const { describe, expect, test } = await import("bun:test");
const { installViewTransitionStyle, viewTransitionStyle } =
  await import("../../src/js/viewTransitionStyle");

/**
 * A page-sized segment must not morph between two page heights: content
 * below the fold would slide through the viewport. The group and image pair
 * are held still; the cross-fade stays for the app's CSS to shape.
 */
describe("the transition style installed with the boundary", () => {
  test("holds the group and image pair still, and nothing else", () => {
    const css = viewTransitionStyle("rsc-navigation");

    expect(css).toContain("::view-transition-group(.rsc-navigation)");
    expect(css).toContain("::view-transition-image-pair(.rsc-navigation)");
    expect(css).toContain("animation:none");
    expect(css).not.toContain("view-transition-old");
    expect(css).not.toContain("view-transition-new");
  });

  test("is installed once, and not at all without a class", () => {
    installViewTransitionStyle(null);
    expect(document.getElementById("rsc-kit-view-transition")).toBeNull();

    installViewTransitionStyle("nav");
    installViewTransitionStyle("nav");
    expect(document.querySelectorAll("#rsc-kit-view-transition").length).toBe(
      1,
    );
    expect(
      document.getElementById("rsc-kit-view-transition")!.textContent,
    ).toContain(".nav");
  });
});
