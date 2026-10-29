"use client";

import { startTransition, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getSlotState, subscribeToSlot } from "./slotStore";
import { RedirectBoundary } from "./RedirectBoundary";
import { SegmentDepthContext } from "./segmentDepth";

/**
 * The seam a re-rendered slot is swapped in at.
 *
 * Server components cannot be re-rendered in the browser, so the swap point
 * has to be a client component reading from a store. With nothing stored it
 * renders what the server sent with the page — which is the behaviour that
 * existed before slots could be revalidated, and is what makes this safe to
 * wrap every slot in.
 *
 * Inside a RedirectBoundary, because a slot is a page too and may decide a
 * redirect inside its own Suspense boundary. A slot of a nested layout sits
 * under the SegmentBoundary above it, which carries one; a slot of the root
 * layout sits under nothing, and without this its redirect would unmount
 * the document.
 *
 * A refresh is swapped in as a transition. Read through useSyncExternalStore it
 * was applied at once - React never treats that store's update as one it can
 * hold back - so content still arriving suspended to the nearest fallback, and
 * a team picker and its breadcrumb blinked to their skeleton on every save.
 * Held in this boundary's state instead, React keeps what is on screen until
 * the new content is ready, and one that is ready shows at once.
 */
export function SlotBoundary({ name, children }: { name: string; children: ReactNode }) {
  // Which navigation replaces this region - see clearSlots.
  const depth = useContext(SegmentDepthContext);
  const [state, setState] = useState(() => getSlotState(name));

  useEffect(() => {
    const sync = () => startTransition(() => setState(getSlotState(name)));
    const unsubscribe = subscribeToSlot(name, sync, depth);

    // A write between the render and this subscription would otherwise wait
    // for the next one.
    sync();

    return unsubscribe;
  }, [name, depth]);

  return (
    <RedirectBoundary>
      {(state.tree === undefined ? children : state.tree) as ReactNode}
    </RedirectBoundary>
  );
}
