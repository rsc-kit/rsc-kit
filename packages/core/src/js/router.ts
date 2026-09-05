/**
 * Programmatic navigation API for use from client components.
 *
 * Reads from window globals set by createViteRscApp, since client components
 * are built in a separate build graph and cannot directly import navigate.ts.
 */

import type { Href } from "../routes.js";

export function visit(
  url: Href,
  opts?: { replace?: boolean }
): Promise<void> {
  const nav = (window as any).__rsc_navigate;

  if (!nav) {
    throw new Error("RSC navigation not initialized. Ensure createViteRscApp has been called.");
  }

  return nav(url, opts);
}

export function prefetch(url: Href, cacheForMs?: number): void {
  const fn = (window as any).__rsc_prefetch;

  if (!fn) {
    throw new Error("RSC navigation not initialized. Ensure createViteRscApp has been called.");
  }

  fn(url, cacheForMs);
}

/**
 * Ask the server for part of the current page again.
 *
 *   refresh()          the page, leaving the layouts mounted
 *   refresh('all')     the whole document
 *   refresh('orders')  one parallel slot
 *
 * The page form leaves the layouts alone, so anything living in one — a count
 * in a sidebar, say — will not move until you ask for 'all'.
 */
export function refresh(target?: string): Promise<void> {
  const fn = (window as any).__rsc_refresh;

  if (!fn) {
    throw new Error("RSC navigation not initialized. Ensure createViteRscApp has been called.");
  }

  return fn(target);
}

const router = { visit, prefetch, refresh };
export default router;
