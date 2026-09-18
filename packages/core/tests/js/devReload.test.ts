import { describe, expect, test } from "bun:test";

import {
  isOutdatedOptimizedDep,
  outdatedDepResponse,
} from "../../src/devReload.js";
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('devReload.test.ts')

/**
 * Vite re-optimising a server pre-bundle under a render is a condition that
 * is over by the time anyone reads the error. The page is asked to reload.
 */
describe("a render that hit a re-optimised dependency", () => {
  test("is recognised by Vite's code, not its wording", () => {
    expect(
      isOutdatedOptimizedDep(
        Object.assign(new Error("x"), { code: "ERR_OUTDATED_OPTIMIZED_DEP" }),
      ),
    ).toBe(true);
    expect(
      isOutdatedOptimizedDep(
        new Error("There is a new version of the pre-bundle"),
      ),
    ).toBe(false);
    expect(isOutdatedOptimizedDep(null)).toBe(false);
  });

  test("a document is told to reload itself", async () => {
    const res = outdatedDepResponse(new Request("http://x/"));

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toContain('http-equiv="refresh"');
  });

  test("a payload request gets something that is not a payload, so the router loads the document", async () => {
    const res = outdatedDepResponse(
      new Request("http://x/", { headers: { "X-RSC": "1" } }),
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});
