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

import { Activity, useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { getSegmentState, seedSegment, subscribeToSegment } from './segmentStore'

export function SegmentBoundary({
  depth,
  pageKey,
  children,
}: {
  depth: number
  /** The page these server-rendered children belong to. */
  pageKey?: string
  children: ReactNode
}) {
  const state = useSyncExternalStore(
    (listener) => subscribeToSegment(depth, listener),
    () => getSegmentState(depth),
    // On the server the tree being rendered IS the current one, so there is
    // never an override; returning null keeps hydration from mismatching.
    () => null,
  )

  // Record the page we arrived on, so a later navigation away and back can
  // return to it. Without this the first page is the one page you cannot keep.
  useEffect(() => {
    if (pageKey) seedSegment(depth, pageKey, children)
  }, [depth, pageKey, children])

  if (!state) return children

  return (
    <>
      {state.entries.map((entry) => (
        <Activity key={entry.key} mode={entry.key === state.activeKey ? 'visible' : 'hidden'}>
          {entry.tree as ReactNode}
        </Activity>
      ))}
    </>
  )
}
