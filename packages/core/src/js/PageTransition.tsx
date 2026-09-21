"use client";

/**
 * The page-level view transition, with WebKit left out of it.
 *
 * WebKit - Safari, and every browser on iOS, Chrome included - rasterises
 * the outgoing snapshot at the element's full height rather than the
 * viewport's. A landing page 12,000 px tall is 44 megapixels at 3×: a port
 * measured ~600 ms with the screen frozen on every navigation away from
 * it, and the memory can have iOS discard the tab, which comes back as a
 * reload nobody asked for. Chromium caps the snapshot, so a desktop never
 * shows it. Other sites' transitions work on the same phone because they
 * name the root, which the spec clips to the viewport; React's
 * <ViewTransition> names the element it wraps, and the page is tall.
 *
 * So the cross-fade runs where it is cheap and is skipped where it is not.
 * Decided after mount, from navigator.vendor - a server render has no
 * navigator, and a transition class only matters on an update, so the
 * first render agrees with the server either way.
 */

import { ViewTransition, useEffect, useState } from "react";
import type { ReactNode } from "react";

/** Whether this browser rasterises a transition snapshot at full element height. */
export function snapshotsWholePage(): boolean {
  return typeof navigator !== "undefined" && navigator.vendor === "Apple Computer, Inc.";
}

export function PageTransition({
  children,
  className,
  transition = "page",
}: {
  children: ReactNode;
  /** On the wrapper element the pair is made of; carry the body's layout here. */
  className?: string;
  /** The view-transition class a navigation gets, for the CSS that shapes it. */
  transition?: string;
}) {
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    if (snapshotsWholePage()) setSkip(true);
  }, []);

  return (
    <ViewTransition default={{ "rsc-navigation": skip ? "none" : transition, default: "none" }}>
      <div className={className}>{children}</div>
    </ViewTransition>
  );
}
