import { describe, expect, test } from "bun:test";

import { isStaleAssetError } from "../../src/js/staleAssets.js";

/**
 * After a deploy an open tab asks for chunks by their old names. The page is
 * loaded again rather than shown an error for a click that used to work.
 */
describe("a chunk the deploy no longer serves", () => {
  test("is recognised in each browser's words", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://app/assets/x-abc.js",
      "Importing a module script failed.",
      "error loading dynamically imported module: https://app/assets/x.js",
      "Loading chunk 12 failed.",
      "Loading CSS chunk 3 failed.",
    ]) {
      expect(isStaleAssetError(new TypeError(message))).toBe(true);
    }
  });

  test("is not any other failure", () => {
    expect(
      isStaleAssetError(new Error("Cannot read properties of undefined")),
    ).toBe(false);
    expect(isStaleAssetError(null)).toBe(false);
  });
});
