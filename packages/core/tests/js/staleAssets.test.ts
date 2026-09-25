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
      // The payload names a client component this build's manifest lacks:
      // the same news as a chunk that is gone, and under a service worker
      // that serves the last build's document first, every returning
      // visitor's first navigation after a deploy.
      "client reference not found 'cab89674a721'",
      "server reference not found 'f3a1#submit'",
    ]) {
      expect(isStaleAssetError(new TypeError(message))).toBe(true);
    }
  });

  test("in development, a hook against a null dispatcher is a re-optimised page", () => {

    // Vite re-optimised the dependencies under a running page: two Reacts.

    process.env.DEV = "1";

    expect(isStaleAssetError(new TypeError("Cannot read properties of null (reading 'useState')"))).toBe(true);

    expect(isStaleAssetError(new Error("Invalid hook call. Hooks can only be called inside of the body of a function component."))).toBe(true);

    delete process.env.DEV;

  });


  test("is not any other failure", () => {
    expect(
      isStaleAssetError(new Error("Cannot read properties of undefined")),
    ).toBe(false);
    expect(isStaleAssetError(null)).toBe(false);
  });
});
