import { describe, expect, test } from "bun:test";

import {
  cancelledByConsumer,
  caughtByLoading,
} from "../../src/js/fallbackReport.js";

/**
 * A read under a boundary the developer wrote is the designed path and says
 * nothing. The same read with nothing closer than a loading.tsx is one line.
 * The component stack, as React gives it in development, says which.
 */
const wrapped = `
    at AuthTrigger (http://x/auth-trigger.tsx:21:23)
    at AuthLinks [Server]
    at Suspense
    at div
    at nav
    at SiteNav [Server]
    at RedirectBoundary (http://x/SegmentBoundary.js:45:24)
    at SegmentBoundary (http://x/SegmentBoundary.js:137:28)
    at body
    at html`;

const onlyLoading = `
    at AuthTrigger (http://x/auth-trigger.tsx:21:23)
    at div
    at SiteNav [Server]
    at Suspense
    at LoadingBoundary (http://x/LoadingBoundary.js:20:10)
    at RedirectBoundary (http://x/SegmentBoundary.js:45:24)
    at SegmentBoundary (http://x/SegmentBoundary.js:137:28)
    at body
    at html`;

// A PPR resume: React leaves server components out of the stack, so a
// <Suspense> the developer wrote at the top of a page sits directly under
// the engine's segment boundary. It is still the developer's.
const resumedUnderTheirOwn = `
    at AuthTrigger (http://x/auth-trigger.tsx:21:23)
    at Suspense
    at RedirectBoundary (http://x/SegmentBoundary.js:45:24)
    at SegmentBoundary (http://x/SegmentBoundary.js:137:28)
    at body
    at html`;

describe("whose boundary caught the read", () => {
  test("the developer's own: nothing to say", () => {
    expect(caughtByLoading(wrapped)).toBe(false);
  });

  test("a loading.tsx of the engine: worth a line", () => {
    expect(caughtByLoading(onlyLoading)).toBe(true);
  });

  test("the developer's own, on a resume with no server frames: still theirs", () => {
    expect(caughtByLoading(resumedUnderTheirOwn)).toBe(false);
  });

  test("no boundary, or no stack: not this report", () => {
    expect(
      caughtByLoading("\n    at AuthTrigger\n    at body\n    at html"),
    ).toBe(false);
    expect(caughtByLoading(undefined)).toBe(false);
    expect(caughtByLoading("")).toBe(false);
  });
});

describe("a render the consumer cancelled", () => {
  test("is React's fixed abort reason, and not a fault to print", () => {
    expect(
      cancelledByConsumer(
        new Error("The render was aborted by the server without a reason."),
      ),
    ).toBe(true);
    expect(
      cancelledByConsumer(
        new Error("The render was aborted by the server with a promise."),
      ),
    ).toBe(true);
    expect(
      cancelledByConsumer(
        new DOMException("The operation was aborted.", "AbortError"),
      ),
    ).toBe(true);
  });

  test("anything else is still an error", () => {
    expect(
      cancelledByConsumer(new Error("Cannot read properties of null")),
    ).toBe(false);
    expect(
      cancelledByConsumer(
        new Error(
          "The render was aborted by the server with a reason: timeout",
        ),
      ),
    ).toBe(false);
    expect(cancelledByConsumer(null)).toBe(false);
    expect(cancelledByConsumer(undefined)).toBe(false);
  });
});
