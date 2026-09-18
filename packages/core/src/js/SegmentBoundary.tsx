"use client";

/**
 * The point in the tree a navigation can replace on its own.
 *
 * Sits between a layout and its children, so showing a different segment
 * re-renders from here down and leaves the layouts above it mounted. Server
 * components cannot be re-rendered on the client, which is why the seam has to
 * be a client component reading from a store rather than the layout itself.
 *
 * Pages it has already shown stay mounted behind <Activity mode="hidden">.
 * Hidden is not unmounted: effects are torn down but state survives, so
 * returning to a page brings back the form you were filling in. Rendering only
 * the current one would throw that away, which is what replacing the root did.
 */

import * as React from "react";
import { Activity, startTransition, useEffect, useState } from "react";

/**
 * The transition type a navigation carries.
 *
 * The engine does not animate a navigation itself; React's own
 * <ViewTransition> does, wherever an app puts one. What the app cannot do
 * from outside is tell a navigation from the seed after hydration - the
 * boundary taking over its own server-rendered children, which animated
 * would be the page fading into itself on every load. So a navigation's
 * update carries this type, and the seed's does not: a boundary keyed on it,
 * `default={{ "rsc-navigation": "page", default: "none" }}`, animates
 * navigations and nothing else.
 *
 * An earlier shape wrapped the segment in a boundary of the engine's own,
 * behind a flag. React names every top-level element under a boundary and
 * morphs each from where it was to where it is, so the stylesheet pulled
 * them back into one root fade - and fought React over the root, which it
 * cancels when nothing outside a boundary changed: a captured root with a
 * hidden group, a dark viewport on the first navigation. One wrapper element
 * under the app's own boundary is one snapshot pair, which is the dissolve
 * wanted, with nothing to fight.
 */
export const NAVIGATION_TRANSITION_TYPE = "rsc-navigation";

// Exported by React 19.3; `unstable_` before it. Read at call time from the
// namespace rather than imported by name, so a React that lacks it still
// loads this module and simply does not mark the type.
const addTransitionType: ((type: string) => void) | undefined =
  (React as { addTransitionType?: (type: string) => void }).addTransitionType ??
  (React as { unstable_addTransitionType?: (type: string) => void })
    .unstable_addTransitionType;
import type { ReactNode } from "react";
import { RedirectBoundary } from "./RedirectBoundary";
import {
  getSegmentState,
  navigatedOnce,
  seedSegment,
  subscribeToSegment,
} from "./segmentStore";

export function SegmentBoundary({
  depth,
  pageKey,
  children,
}: {
  depth: number;
  /** The page these server-rendered children belong to. */
  pageKey?: string;
  children: ReactNode;
}) {
  // The store still addresses the boundary; the render reads React state, so
  // the update can be a transition. Initialised from the store on the client
  // and null on the server — exactly what getServerSnapshot did.
  const [state, setState] = useState<ReturnType<typeof getSegmentState>>(() =>
    typeof window === "undefined" ? null : getSegmentState(depth),
  );

  useEffect(
    () =>
      subscribeToSegment(depth, () => {
        startTransition(() => {
          // A navigation, not the seed: the seed is the page taking over
          // its own server-rendered children, and fading that is the page
          // fading into itself.
          if (navigatedOnce()) addTransitionType?.(NAVIGATION_TRANSITION_TYPE);

          setState(getSegmentState(depth));
        });
      }),
    [depth],
  );

  // Record the page we arrived on, so a later navigation away and back can
  // return to it. Without this the first page is the one page you cannot keep.
  useEffect(() => {
    if (pageKey) seedSegment(depth, pageKey, children);
  }, [depth, pageKey, children]);

  // Wrapped here rather than around the whole app because this is the closest
  // client component above a page: a redirect thrown inside the page's own
  // Suspense boundary surfaces at the nearest error boundary, and catching it
  // here leaves the layouts above mounted while the navigation runs.
  // The same shape before and after the seed. The server's render and the
  // first client render already place the children inside the retention
  // wrapper, keyed by the page, so when the store takes over after hydration
  // the tree changes state but not shape - and React keeps the DOM instead of
  // remounting the page, which was blank, then content, on every load.
  if (!state) {
    return (
      <RedirectBoundary>
        {pageKey ? (
          <Activity key={pageKey} mode="visible">
            {children}
          </Activity>
        ) : (
          children
        )}
      </RedirectBoundary>
    );
  }

  return (
    <RedirectBoundary>
      {state.entries.map((entry) => (
        <Activity
          key={entry.key}
          mode={entry.key === state.activeKey ? "visible" : "hidden"}
        >
          {entry.tree as ReactNode}
        </Activity>
      ))}
    </RedirectBoundary>
  );
}
