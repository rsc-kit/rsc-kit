/**
 * Keeps recently visited pages mounted but hidden, so going back restores them
 * rather than rebuilding them.
 *
 * Rendering each navigation with root.render() unmounts the previous tree, and
 * unmounting destroys client state: a half-typed form, an open disclosure, a
 * scrolled list. React's <Activity mode="hidden"> hides a tree without
 * unmounting it — effects are torn down, but state survives — which is what
 * makes returning feel like the browser's own back button rather than a reload.
 *
 * Retention is bounded. Hidden trees keep their DOM, so an unbounded history
 * would grow the document for the length of the session; the least recently
 * visited entry is dropped past the limit.
 */

import { Activity, useCallback, useEffect, useRef, useState, startTransition } from 'react'
import type { ReactNode } from 'react'
import { setNavigateHandler, setReplaceRootHandler, setRestoreHandler } from './navigate'
import { navigationCommitted } from './perf'
import { clearSegments, setSegment } from './segmentStore'

export interface RouterEntry {
  /** Identifies the page: its URL, or the intercept variant of one. */
  key: string
  tree: ReactNode
}

export interface ActivityRouterHandle {
  /** Show `tree` for `key`, retaining whatever was visible before. */
  show(key: string, tree: ReactNode): void
  /**
   * Give the visible page a new tree, in place: the same entry, the same
   * Activity, re-rendered. For a re-render of the whole document after an
   * action - revalidate("all") - which is the page the visitor is on, not a
   * page they went to. show() under the current url made a NEW entry when
   * the visible one was keyed by the url the document loaded with, and
   * every partial navigation since had left that key alone: the whole app
   * remounted under a second Activity, the old one hidden behind it, and
   * the form's state - its "added to cart" - went with it.
   */
  replace(tree: ReactNode): void
  /** Reveal a retained page without refetching. False when not retained. */
  restore(key: string): boolean
  /** Drop every retained page but the visible one. */
  clear(): void
}

/** Pages kept alive behind the visible one. Four covers ordinary back-and-forth. */
export const DEFAULT_RETENTION = 4

export function useActivityRouter(
  initial: RouterEntry,
  retention: number = DEFAULT_RETENTION,
): { entries: RouterEntry[]; activeKey: string; handle: ActivityRouterHandle } {
  const [entries, setEntries] = useState<RouterEntry[]>([initial])
  const [activeKey, setActiveKey] = useState(initial.key)

  // The router calls into this from outside React, where the values captured by
  // the last render may already be stale. Refs mirror state so those calls read
  // what is actually mounted.
  const entriesRef = useRef(entries)
  const orderRef = useRef<string[]>([initial.key])

  const commit = useCallback((next: RouterEntry[]) => {
    entriesRef.current = next
    setEntries(next)
  }, [])

  // Recency, most recent last. Retention is by visit order rather than
  // insertion, so bouncing between two pages evicts neither.
  const touch = useCallback(
    (key: string) => {
      const next = orderRef.current.filter((k) => k !== key)
      next.push(key)
      orderRef.current = next.slice(-Math.max(1, retention))

      return orderRef.current
    },
    [retention],
  )

  const show = useCallback(
    (key: string, tree: ReactNode) => {
      const kept = touch(key)
      const others = entriesRef.current.filter((entry) => entry.key !== key && kept.includes(entry.key))

      commit([...others, { key, tree }])
      setActiveKey(key)
    },
    [commit, touch],
  )

  const replace = useCallback(
    (tree: ReactNode) => {
      const active = entriesRef.current.find((entry) => entry.key === activeKey)

      if (!active) return

      // A transition, so a boundary in the new tree still waiting on its row
      // keeps what is on screen rather than showing its fallback - which
      // would unmount the form under it and take its state along. The
      // document's payload arrives with some rows still pending, and a
      // synchronous render showed the product's skeleton for a frame and
      // remounted the "add to cart" form beneath it.
      startTransition(() => {
        commit(entriesRef.current.map((entry) => (entry === active ? { key: entry.key, tree } : entry)))
      })
    },
    [activeKey, commit],
  )

  const restore = useCallback(
    (key: string) => {
      if (!entriesRef.current.some((entry) => entry.key === key)) return false

      touch(key)
      setActiveKey(key)

      return true
    },
    [touch],
  )

  const clear = useCallback(() => {
    const kept = entriesRef.current.filter((entry) => entry.key === activeKey)

    commit(kept)
    orderRef.current = [activeKey]
  }, [activeKey, commit])

  const handleRef = useRef<ActivityRouterHandle>({ show, replace, restore, clear })
  handleRef.current = { show, replace, restore, clear }

  return { entries, activeKey, handle: handleRef.current }
}

/**
 * Root of the hydrated app.
 *
 * Registers itself with the navigation engine so a navigation becomes a state
 * update here rather than a fresh root.render(), which is what allows the
 * previous page to stay mounted.
 */
export function ActivityRoot({ initialKey, initialTree }: { initialKey: string; initialTree: ReactNode }) {
  const { entries, activeKey, handle } = useActivityRouter({ key: initialKey, tree: initialTree })

  // A whole document shown, or a held page revealed: the navigation's commit.
  useEffect(() => {
    navigationCommitted()
  }, [activeKey, entries])

  useEffect(() => {
    setNavigateHandler((tree, key, segmentDepth) => {
      // A partial payload replaces one segment inside the page that is already
      // showing; only a whole document is a new page to retain.
      if (segmentDepth > 0) {
        setSegment(segmentDepth, key, tree as ReactNode)

        return
      }

      clearSegments()
      handle.show(key, tree as ReactNode)
    })

    setRestoreHandler((key) => handle.restore(key))
    setReplaceRootHandler((tree) => handle.replace(tree as ReactNode))
  }, [handle])

  return (
    <>
      {entries.map((entry) => (
        <Activity key={entry.key} mode={entry.key === activeKey ? 'visible' : 'hidden'}>
          {entry.tree}
        </Activity>
      ))}
    </>
  )
}
