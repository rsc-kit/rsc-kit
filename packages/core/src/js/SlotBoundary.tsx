"use client";

import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { getSlotState, subscribeToSlot } from "./slotStore";
import { RedirectBoundary } from "./RedirectBoundary";

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
 */
export function SlotBoundary({ name, children }: { name: string; children: ReactNode }) {
  const state = useSyncExternalStore(
    (listener) => subscribeToSlot(name, listener),
    () => getSlotState(name),
    () => getSlotState(name),
  );

  return (
    <RedirectBoundary>
      {(state.tree === undefined ? children : state.tree) as ReactNode}
    </RedirectBoundary>
  );
}
