'use client'

// Reading a query from a client component.
//
// State rather than Suspense, and that is forced rather than chosen. React's
// SSR runtime refuses a server-function call during the initial render —
// "Server Functions cannot be called during initial render" — and reaching the
// id means calling the reference, so an unseeded read simply cannot happen on
// the server from here. Suspending instead would be worse than the refusal: a
// boundary that never resolves holds the HTML stream open, so the page hangs
// rather than erroring.
//
// A SEEDED read has none of that problem. A server component awaited the query
// itself and passed the answer down, so there is nothing to call and nothing to
// wait for: the value is in the cache before the first render, on the server
// and again after hydration. That is the whole of what SWR needs
// `unstable_serialize`, a `fallback` object and a matching `fetcher` for.

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { invalidateQuery, peekQuery, queryKey, readQuery, seedQuery } from './queryClient'

export interface QueryOptions<Data> {
  /**
   * An answer the caller already has, usually from a server component.
   *
   *     // a server component
   *     const first = await getListings(filters)
   *     return <Listings filters={filters} initial={first} />
   *
   *     // the client component
   *     useQuery(getListings, [filters], { initialData: initial })
   *
   * Seeds the cache under the same key the read would use, so the first render
   * already has data and no request is made — and any other component reading
   * the same query gets it too, without being passed anything.
   */
  initialData?: Data
}

export interface QueryState<Data> {
  /** What the query answered, once it has. */
  data: Data | undefined
  /** Why it did not, if it did not. */
  error: Error | undefined
  /** No answer for these arguments yet. False from the first render when seeded. */
  isLoading: boolean
  /** Forget the answer and read again. */
  refresh: () => void
}

interface Held {
  /** The arguments the held answer belongs to. */
  key: string
  data?: unknown
  error?: Error
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
  options: QueryOptions<Data> = {},
): QueryState<Data> {
  // The arguments as one string, so everything below keys off what is being
  // asked for rather than off the array the caller happened to build — which,
  // for an inline object literal, is a new one every render.
  const key = queryKey(args)
  const { initialData } = options

  // Seeded during render rather than in an effect, and that is the point of a
  // seed: an effect runs after the first paint, so the component would render
  // its loading state once for data it already had. The write is idempotent
  // and keyed, and an existing entry wins, so repeating it changes nothing.
  if (initialData !== undefined) seedQuery(reference, args, initialData)

  const [held, setHeld] = useState<Held>(() => fromCache(reference, args, key))

  // Read through a ref so changing them does not re-run the effect. The key
  // already says whether they differ in any way that matters.
  const latest = useRef({ reference, args })

  latest.current = { reference, args }

  const [nonce, setNonce] = useState(0)

  // Whatever is already known for THESE arguments. On the render where the
  // arguments change, `held` still belongs to the previous ones — reporting it
  // as settled would show the old answer with isLoading false under the new
  // arguments, which reads as data that is merely wrong rather than pending.
  const current = held.key === key ? held : fromCache(reference, args, key)
  const settled = current.key === key && (current.data !== undefined || current.error !== undefined)

  useEffect(() => {
    // Nothing to fetch: a seed, or an answer another component already got.
    if (peekQuery(latest.current.reference, latest.current.args)) {
      // Only when this component is not already holding it. fromCache builds a
      // new object every call, so writing it unconditionally is a re-render per
      // mount that changes nothing on screen.
      setHeld((current) =>
        current.key === key
          ? current
          : fromCache(latest.current.reference, latest.current.args, key),
      )

      return
    }

    let live = true

    readQuery(latest.current.reference, latest.current.args).then(
      (data) => {
        // Checked before every write: an answer arriving after the component is
        // gone is a React warning, and one arriving after the arguments changed
        // would show the previous query's data under the new ones.
        if (live) setHeld({ key, data })
      },
      (error: unknown) => {
        if (live) setHeld({ key, error: error instanceof Error ? error : new Error(String(error)) })
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
    data: current.data as Data | undefined,
    error: current.error,
    isLoading: !settled,
    refresh,
  }
}

/**
 * Read a query and suspend until it answers.
 *
 * For a boundary that owns the fallback. Safe only where the read can happen:
 * seeded by a server component, or in a component that renders in the browser
 * alone — an unseeded read during server rendering throws, because React
 * refuses the call that reaching the query's id requires.
 */
export function useSuspenseQuery<Data>(
  reference: (...args: never[]) => Promise<Data>,
  args: unknown[] = [],
  options: QueryOptions<Data> = {},
): Data {
  if (options.initialData !== undefined) seedQuery(reference, args, options.initialData)

  // Answered from the cache before anything is called, which is what lets a
  // seeded read work during server rendering: there is no reference to invoke,
  // so React's refusal never comes up.
  const settled = peekQuery(reference, args)

  if (settled) {
    if ('error' in settled) throw settled.error

    return settled.value as Data
  }

  // `use`, not a thrown promise. readQuery hands back the same promise for the
  // same arguments every time, so the re-render after it resolves finds the
  // answer rather than starting the read again.
  return use(readQuery(reference, args))
}

function fromCache(
  reference: (...args: never[]) => unknown,
  args: unknown[],
  key: string,
): Held {
  const settled = peekQuery(reference, args)

  if (!settled) return { key }
  if ('error' in settled) {
    return {
      key,
      error: settled.error instanceof Error ? settled.error : new Error(String(settled.error)),
    }
  }

  return { key, data: settled.value }
}
