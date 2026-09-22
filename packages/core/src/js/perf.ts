/**
 * A navigation, on the browser's own timeline.
 *
 * "Slow on my phone" has no number in it, and the number it needs is not one
 * a network panel shows: the time from the tap to the new page on screen,
 * and where inside it the time went. Three marks and a measure, in the User
 * Timing API - so the Performance panel of any browser's dev tools shows
 * them, and `performance.getEntriesByName('rsc-kit:navigate')` in a console
 * answers with the duration of each navigation since the page loaded.
 *
 *   rsc-kit:navigate:start    the click
 *   rsc-kit:navigate:decoded  the payload decoded and the chunks it names loaded
 *   rsc-kit:navigate:pictures the pictures the page shows at once are decoded, or the wait for them is up
 *   rsc-kit:navigate:applied  handed to React
 *   rsc-kit:navigate          start to the commit that put the page on screen
 *
 * A gap before `decoded` is the network or the chunks: the page was not
 * prefetched, or was prefetched but never decoded. A gap after `applied` is
 * the render, which is the page's own size.
 */

const timing =
  typeof performance !== "undefined" && typeof performance.mark === "function" && typeof performance.measure === "function";

let open = false;

export function navigationStarted(url: string): void {
  if (!timing) return;

  try {
    performance.mark("rsc-kit:navigate:start", { detail: url });
    open = true;
  } catch {
    // An older User Timing without mark options: the measure below still works
    // from a plain mark.
    performance.mark("rsc-kit:navigate:start");
    open = true;
  }
}

export function navigationReached(phase: "decoded" | "pictures" | "applied"): void {
  if (!timing || !open) return;

  performance.mark(`rsc-kit:navigate:${phase}`);
}

/** The commit that put the page on screen. Closes the open navigation, if one is. */
export function navigationCommitted(): void {
  if (!timing || !open) return;

  open = false;

  try {
    performance.measure("rsc-kit:navigate", "rsc-kit:navigate:start");
  } catch {
    // The start mark was cleared by the page; nothing to measure from.
  }
}

/** A navigation that ended before a commit - aborted, overtaken, redirected. */
export function navigationAbandoned(): void {
  open = false;
}
