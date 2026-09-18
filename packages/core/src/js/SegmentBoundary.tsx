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

import {
  ViewTransition,
  Activity,
  addTransitionType,
  startTransition,
  useEffect,
  useState,
} from "react";
import type { ReactNode as Node, ViewTransitionClassPerType } from "react";

/** Replaced at build time by rscKit({ viewTransitions }): the class, or false. */
declare const __RSC_VIEW_TRANSITIONS__: boolean | string | undefined;

// Read once. Undefined when an app builds without the plugin's define — a test
// importing this module directly, say — and off is the right answer there.
//
// The class is what lets the app's CSS shape or silence the animation:
// `::view-transition-old(.rsc-navigation) { animation: none }`. A build from
// before the class existed defines true; it gets the default name.
const TRANSITION_CLASS =
  typeof __RSC_VIEW_TRANSITIONS__ === "string"
    ? __RSC_VIEW_TRANSITIONS__
    : typeof __RSC_VIEW_TRANSITIONS__ === "boolean" && __RSC_VIEW_TRANSITIONS__
      ? "rsc-navigation"
      : null;

/** The class the navigated segment's transition carries, or null when the build did not ask to animate. */
export const NAVIGATION_TRANSITION_CLASS = TRANSITION_CLASS;

/** The transition type a navigation carries, so the class applies to navigations and to nothing else. */
export const NAVIGATION_TRANSITION_TYPE = "rsc-navigation";

/**
 * The boundary's classes by transition type. Constant across renders, on
 * purpose: React measures a boundary with the props of the render before,
 * and a `default` that flipped from "none" to the class on the first
 * navigation left that navigation unmeasured. React then read the root as
 * untouched and hid its group - with the stylesheet forcing the root back
 * on, a dark viewport until the fade ended. The first navigation, every time.
 *
 * So the props never change. What changes is the transition: a navigation
 * adds the type (below), the seed after hydration does not, and "none" is
 * what React uses when no type matches - a first load or a reload never
 * animates, because there is nothing to animate from.
 */
export function navigationTransitionClasses(
  className: string,
): ViewTransitionClassPerType {
  return { [NAVIGATION_TRANSITION_TYPE]: className, default: "none" };
}

const CLASSES = TRANSITION_CLASS
  ? navigationTransitionClasses(TRANSITION_CLASS)
  : null;

const Animated = ({ children }: { children: Node }) =>
  CLASSES ? (
    <ViewTransition default={CLASSES}>{children}</ViewTransition>
  ) : (
    <>{children}</>
  );
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
          if (CLASSES && navigatedOnce()) {
            addTransitionType(NAVIGATION_TRANSITION_TYPE);
          }

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
          <Animated>
            <Activity key={pageKey} mode="visible">
              {children}
            </Activity>
          </Animated>
        ) : (
          children
        )}
      </RedirectBoundary>
    );
  }

  return (
    <RedirectBoundary>
      <Animated>
        {state.entries.map((entry) => (
          <Activity
            key={entry.key}
            mode={entry.key === state.activeKey ? "visible" : "hidden"}
          >
            {entry.tree as ReactNode}
          </Activity>
        ))}
      </Animated>
    </RedirectBoundary>
  );
}
