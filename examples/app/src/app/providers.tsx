'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

/**
 * One QueryClient per browser session.
 *
 * Built in `useState` rather than at module scope: a module-level client is
 * shared by every request when this module is evaluated on the server, so one
 * visitor's cached pages are handed to the next.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A read this package answers is already deduped and batched below
            // the cache. What TanStack adds on top is retry and revalidation
            // policy, and the default of "stale immediately" would undo the
            // seeding the server did — see the note in the infinite example.
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
