"use client";

/**
 * The page-level view transition, with WebKit left out of it.
 *
 * WebKit - Safari, and every browser on iOS, Chrome included - rasterises
 * the outgoing snapshot at the element's full height rather than the
 * viewport's. A landing page 12,000 px tall is 44 megapixels at 3×: a port
 * measured 600-900 ms with the screen frozen on every navigation away from
 * it, and the memory can have iOS discard the tab, which comes back as a
 * reload nobody asked for. Chromium caps the snapshot, so a desktop never
 * shows it. Other sites' transitions work on the same phone because they
 * name the root, which the spec clips to the viewport; React's
 * <ViewTransition> names the element it wraps, and the page is tall.
 *
 * So the cross-fade runs where it is cheap and is skipped where it is not.
 * Decided after mount, from navigator.vendor - a server render has no
 * navigator, and a transition class only matters on an update, so the
 * first render agrees with the server either way. Skipped, React starts
 * no transition at all: no snapshot, no overlay, nothing to wait for.
 *
 * The CSS the fade needs travels with it, because every app rediscovered
 * the same three lines on a phone: the group and root pairs keep the
 * browser's 250 ms whatever the page pair is set to, so a "120 ms" fade
 * ran 290; the pseudo-element tree sits over the document while it runs
 * and swallows a second tap; and reduced motion should mean none.
 */

import { ViewTransition, useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * Whether this browser rasterises a transition snapshot at full element
 * height. Apple's vendor string is WebKit's, wherever WebKit runs: Safari,
 * every iOS browser, and WebKitGTK (Epiphany) too - all of them charge by
 * snapshot size, so all of them are right to skip. Not a bug to "fix".
 */
export function snapshotsWholePage(): boolean {
  return typeof navigator !== "undefined" && navigator.vendor === "Apple Computer, Inc.";
}

/** Whether the visitor asked for no motion; a transition then costs a snapshot for nothing. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The rules a page fade needs, for the class the navigation carries. */
export function pageTransitionCss(transition: string, durationMs: number): string {
  return (
    `::view-transition-old(.${transition}),::view-transition-new(.${transition}),` +
    `::view-transition-group(*),::view-transition-old(root),::view-transition-new(root){animation-duration:${durationMs}ms}` +
    `::view-transition{pointer-events:none}` +
    `@media (prefers-reduced-motion:reduce){::view-transition-old(*),::view-transition-new(*),::view-transition-group(*){animation:none}}`
  );
}

export function PageTransition({
  children,
  className,
  transition = "page",
  duration = 120,
  webkit = "skip",
}: {
  children: ReactNode;
  /** On the wrapper element the pair is made of; carry the body's layout here. */
  className?: string;
  /** The view-transition class a navigation gets, for CSS of your own on top. */
  transition?: string;
  /** How long the fade runs, in milliseconds. The group and root pairs match it. */
  duration?: number;
  /**
   * What WebKit gets. `skip` for an app with long pages - the default,
   * since a landing page usually is one; `run` for an app whose pages are
   * a screen tall, where the snapshot is small and the fade is fine.
   */
  webkit?: "skip" | "run";
}) {
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    if ((webkit === "skip" && snapshotsWholePage()) || prefersReducedMotion()) setSkip(true);
  }, [webkit]);

  return (
    <ViewTransition default={{ "rsc-navigation": skip ? "none" : transition, default: "none" }}>
      <div className={className}>
        <style href={`rsc-kit-page-transition-${transition}`} precedence="rsc-kit">
          {pageTransitionCss(transition, duration)}
        </style>
        {children}
      </div>
    </ViewTransition>
  );
}
