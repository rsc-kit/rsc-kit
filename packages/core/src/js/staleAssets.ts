/**
 * A navigation that lands on a chunk that is no longer there.
 *
 * After a deploy the open tab still holds the old page, and its next
 * navigation asks for client components by the old hashed names, which the
 * new deploy does not serve. The dev server does the same when it
 * re-optimises dependencies and answers the old names with 504. Either way
 * the payload arrives and React fails to load the module it names, on a
 * page that was working a click ago.
 *
 * The fix is the one the browser would have applied: load the document again.
 * Once — a second failure on the same url within a few seconds means the
 * deploy is broken, not stale, and reloading forever would hide that.
 */

const STALE_MODULE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Outdated Optimize Dep|Loading (?:CSS )?chunk/i;

const RELOADED = "rsc-kit:reloaded";
const WINDOW_MS = 10_000;

/**
 * Development only: the shape a page takes when Vite re-optimised the
 * browser's dependencies underneath it. Modules already loaded hold the old
 * React, freshly loaded ones the new; a hook then reads a null dispatcher.
 * The page is over either way; loading it again is what Vite would do next.
 */
const MIXED_REACT = /Invalid hook call|Cannot read properties of null \(reading 'use[A-Z]\w*'\)/;

export function isStaleAssetError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? error);

  if (STALE_MODULE.test(message)) return true;

  return !!import.meta.env?.DEV && MIXED_REACT.test(message);
}

/** True when the page is being reloaded for it; false when the error is something else, or reloading already failed. */
export function recoverFromStaleAssets(error: unknown): boolean {
  if (!isStaleAssetError(error) || typeof window === "undefined") return false;

  const mark = `${RELOADED}:${window.location.href}`;

  try {
    const last = Number(sessionStorage.getItem(mark) ?? 0);

    if (Date.now() - last < WINDOW_MS) return false;

    sessionStorage.setItem(mark, String(Date.now()));
  } catch {
    // No storage: reload anyway, once is the best that can be promised.
  }

  window.location.reload();

  return true;
}
