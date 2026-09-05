"use client";

import { useEffect } from "react";

/**
 * Keeps document.title on the page you are actually looking at.
 *
 * A page's <title> is rendered inside its own tree so React 19 hoists it into
 * <head>, which is right for a server render and wrong the moment a boundary
 * starts retaining pages. A retained page is still mounted — that is what makes
 * returning to it restore its state — so its <title> is still in the tree, React
 * hoists that one too, and <head> ends up holding one per retained page.
 * `document.title` reads the first, which is the oldest of them: the title lags
 * a navigation behind, deterministically, and looks like a race because it
 * depends on which pages happen to be retained.
 *
 * An effect settles it, because `<Activity mode="hidden">` tears effects down
 * and re-runs them on show. Exactly one page's effect is live at a time — the
 * visible one — so this needs no notion of navigation, history or which tree is
 * current. It is only rendered on a route that ships a runtime; one that does
 * not has no router, no retention, and a single <title> that was always right.
 */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    if (document.title !== title) document.title = title;
  }, [title]);

  return null;
}
