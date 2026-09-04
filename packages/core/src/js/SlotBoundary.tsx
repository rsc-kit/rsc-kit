"use client";

import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { getSlotState, subscribeToSlot } from "./slotStore";

/**
 * The seam a re-rendered slot is swapped in at.
 *
 * Server components cannot be re-rendered in the browser, so the swap point
 * has to be a client component reading from a store. With nothing stored it
 * renders what the server sent with the page — which is the behaviour that
 * existed before slots could be revalidated, and is what makes this safe to
 * wrap every slot in.
 */
export function SlotBoundary({ name, children }: { name: string; children: ReactNode }) {
  const state = useSyncExternalStore(
    (listener) => subscribeToSlot(name, listener),
    () => getSlotState(name),
    () => getSlotState(name),
  );

  return (state.tree === undefined ? children : state.tree) as ReactNode;
}
