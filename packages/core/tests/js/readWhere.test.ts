import { describe, expect, test } from "bun:test";

import {
  connection,
  cookies,
  headers,
  requestReadBy,
  requestReadWhere,
  withRequest,
} from "../../src/request.js";

/**
 * A build that refuses a page has to say which read blocked it and where.
 * The accessor knows its own name; the component that called it is on the
 * stack at the moment of the read, because an accessor runs synchronously up
 * to the point it suspends.
 */
describe("a request read remembers the component that made it", () => {
  test("names the accessor and the caller", async () => {
    const seen = await withRequest(null, async () => {
      async function RootLayout() {
        void cookies();
      }

      async function Orders() {
        void headers();
      }

      await RootLayout();
      await Orders();

      return { by: requestReadBy(), where: requestReadWhere() };
    });

    expect(seen.by).toEqual(["cookies()", "headers()"]);
    expect(seen.where).toEqual([
      "cookies() in RootLayout",
      "headers() in Orders",
    ]);
  });

  test("a read inside a shared helper names the helper and the component that called it", async () => {
    // getCurrentUser wrapped in cache() runs once, on whichever component
    // called first; every other caller is invisible to the stack. Naming the
    // helper says what they all have in common.
    const seen = await withRequest(null, async () => {
      async function getCurrentUser() {
        void connection();
      }

      async function AuthLinks() {
        await getCurrentUser();
      }

      await AuthLinks();

      return requestReadWhere();
    });

    expect(seen).toEqual(["connection() in getCurrentUser (from AuthLinks)"]);
  });

  test("a read inside a cache() helper names every component that awaited it", async () => {
    // The helper runs once; the second caller is a cache hit and never
    // reaches connection(). It is usually the second caller - the one with
    // no boundary above it - that blocks the page, so both are named.
    const { cache } = await import("../../src/cache.js");
    const { withCache } = await import("../../src/cache.js");

    const seen = await withRequest(null, () =>
      withCache(async () => {
        const getCurrentUser = cache(async () => {
          void connection();
        });

        async function AuthLinks() {
          await getCurrentUser();
        }

        async function AuthDialogSlot() {
          await getCurrentUser();
        }

        await Promise.all([AuthLinks(), AuthDialogSlot()]);

        return requestReadWhere();
      }),
    );

    expect(seen).toEqual([
      "connection() awaited by AuthLinks and AuthDialogSlot",
    ]);
  });

  test("a read with no named caller still reports the accessor", async () => {
    const seen = await withRequest(null, async () => {
      void cookies();

      return requestReadWhere();
    });

    expect(seen[0]).toMatch(/^cookies\(\)/);
  });
});
