// iOS launch screens: the size is in the file's name, the media query comes
// from a table, and nothing opens the image. A pixel ratio off by one matches
// no device, silently - which is what writing these by hand gets wrong.

import { describe, expect, test } from "bun:test";
import { isAppleSplash, splashMedia, unknownSplashes } from "../../src/appleSplash";

describe("a launch screen's media query", () => {
  test("an iPhone, portrait and landscape", () => {
    expect(splashMedia("apple-splash-1290x2796.png")).toBe(
      "screen and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
    );
    expect(splashMedia("apple-splash-2796x1290.png")).toContain("(orientation: landscape)");
    expect(splashMedia("apple-splash-2796x1290.png")).toContain("(device-width: 430px) and (device-height: 932px)");
  });

  test("two devices of one css size told apart by their pixel ratio", () => {
    // An XR and an XS Max are both 414x896; only the ratio differs.
    expect(splashMedia("apple-splash-828x1792.png")).toContain("(-webkit-device-pixel-ratio: 2)");
    expect(splashMedia("apple-splash-1242x2688.png")).toContain("(-webkit-device-pixel-ratio: 3)");
  });

  test("an iPad", () => {
    expect(splashMedia("apple-splash-2048x2732.png")).toContain("(device-width: 1024px) and (device-height: 1366px)");
  });

  test("jpeg as well as png", () => {
    expect(splashMedia("apple-splash-1179x2556.jpg")).not.toBeNull();
  });

  test("nothing for a size no device has, or a file that is not one", () => {
    expect(splashMedia("apple-splash-1000x2000.png")).toBeNull();
    expect(splashMedia("apple-icon.png")).toBeNull();
    expect(isAppleSplash("apple-splash-1179x2556.webp")).toBe(false);
  });

  test("the unmatched are named, the rest are not", () => {
    expect(unknownSplashes(["apple-splash-1179x2556.png", "apple-splash-1000x2000.png", "icon.png"])).toEqual([
      "apple-splash-1000x2000.png",
    ]);
  });
});
