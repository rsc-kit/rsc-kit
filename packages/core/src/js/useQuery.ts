'use client'

// Reading a query from a client component.
//
// State rather than Suspense, and that is forced rather than chosen. React's
// SSR runtime refuses a server-function call during the initial render —
// "Server Functions cannot be called during initial render" — and reaching the
// id means calling the reference, so a read simply cannot happen on the server
// from here. Suspending instead would be worse than the refusal: a boundary
// that never resolves holds the HTML stream open, so the page hangs rather
// than erroring.
//
// So this renders a loading state on the server, and reads once the browser
// has it. The round trip that costs is what phase 2 removes, by letting a
// server component resolve the read during render and seed this cache with the
// answer — at which point the first render already has data and `use()` on a
// seeded read becomes safe.

import { useCallback, useEffect, useRef, useState } from 'react'
import { invalidateQuery, queryKey, readQuery } from './queryClient'

export interface QueryState<Data> {
  /** What the query answered, once it has. */
  data: Data | undefined
  /** Why it did not, if it did not. */
  error: Error | undefined
  /** No answer yet. True on the server, and until the first read settles. */
  isLoading: boolean
  /** Forget the answer and read again. */
  refresh: () => void
}

/**
 * Read a query, and re-read when its arguments change.
 *
 * Several components calling this with the same arguments are one request:
 * they share the cache entry, and reads that start in the same tick leave as
 * one batched GET.
 */
export function useQuery<Data>(
  reference: (...args: never[]) => Promise<Data>,
  args: unknown[] = [],
): QueryState<Data> {
  const [state, setState] = useState<{ data?: Data; error?: Error }>({})

  // The arguments as one string, so the effect re-runs when what is being
  // asked for changes rather than when the caller happened to build a new
  // array — which, for an inline object literal, is every render.
  const key = queryKey(args)

  const [pendingKey, setPendingKey] = useState<string | null>(key)

  // Read through a ref so changing them does not re-run the effect. The key
  // already says whether they differ in any way that matters.
  const latest = useRef({ reference, args })

  latest.current = { reference, args }

  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let live = true

    setPendingKey(key)

    readQuery(latest.current.reference, latest.current.args).then(
      (data) => {
        // Checked before every state write: an answer arriving after the
        // component is gone is a React warning, and one arriving after the
        // arguments changed would show the previous query's data under the new
        // ones.
        if (!live) return

        setState({ data })
        setPendingKey(null)
      },
      (error: unknown) => {
        if (!live) return

        setState({ error: error instanceof Error ? error : new Error(String(error)) })
        setPendingKey(null)
      },
    )

    return () => {
      live = false
    }
  }, [key, nonce])

  const refresh = useCallback(() => {
    invalidateQuery(latest.current.reference, latest.current.args)
    setNonce((n) => n + 1)
  }, [])

  return {
    data: state.data,
    error: state.error,
    // Loading while a read for THIS key is outstanding. Comparing against the
    // key rather than holding a boolean keeps the first render of a changed
    // argument set out of the state where it reports `isLoading: false` beside
    // the previous answer.
    isLoading: pendingKey === key,
    refresh,
  }
}
