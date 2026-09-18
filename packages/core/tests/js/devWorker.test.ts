import { describe, expect, test } from "bun:test";

import { DEV_WORKER } from "../../src/vite.js";

/**
 * A worker a production run registered on localhost outlives that run and
 * answers the dev server's documents from its cache. The dev server serves,
 * at the same url, a worker that removes it.
 */
describe("the worker the dev server serves", () => {
  test("takes over at once, drops the caches, unregisters, and reloads the pages it held", () => {
    expect(DEV_WORKER).toContain("skipWaiting()");
    expect(DEV_WORKER).toContain("startsWith('rsc-kit-')");
    expect(DEV_WORKER).toContain("caches.delete(k)");
    expect(DEV_WORKER).toContain("clients.claim()");
    expect(DEV_WORKER).toContain("registration.unregister()");
    expect(DEV_WORKER).toContain("page.navigate(page.url)");
  });

  test("is plain script, not a module, so any browser installs it", () => {
    expect(DEV_WORKER).not.toContain("import ");
    expect(DEV_WORKER).not.toContain("export ");
  });
});
