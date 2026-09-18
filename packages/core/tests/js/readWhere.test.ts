import { describe, expect, test } from "bun:test";

import {
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

  test("a read with no named caller still reports the accessor", async () => {
    const seen = await withRequest(null, async () => {
      void cookies();

      return requestReadWhere();
    });

    expect(seen[0]).toMatch(/^cookies\(\)/);
  });
});
