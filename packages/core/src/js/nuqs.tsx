'use client'

/**
 * nuqs, driving this router instead of `location.assign`.
 *
 *     import { NuqsAdapter } from '@rsc-kit/core/nuqs'
 *
 * The stock `nuqs/adapters/react` works for a shallow update — it writes the
 * url and nothing else. For `shallow: false`, where a server component should
 * re-render with the new query, it has no router to call and falls back to a
 * full page load. This hands that case to `navigate()`, which refetches the
 * page's payload in place and keeps every bit of client state.
 *
 * Shipped from here rather than pasted into apps because it is the one piece
 * of glue that is easy to get subtly wrong — our useSearchParams listens for
 * an event rather than for history changes, and an adapter that forgets to
 * fire it leaves the rest of the page reading a stale query — and because
 * nuqs still marks its adapter api `unstable_`. When that moves, this moves
 * once.
 *
 * nuqs is an optional peer: this entry is the only thing that imports it.
 */

import { unstable_createAdapterProvider as createAdapterProvider, renderQueryString } from 'nuqs/adapters/custom'
import type { unstable_AdapterInterface as AdapterInterface } from 'nuqs/adapters/custom'
import { visit } from './router'
import { useSearchParams } from './useSearchParams'
import type { Href } from '../routes'

function useRscKitAdapter(): AdapterInterface {
  const searchParams = useSearchParams()

  return {
    searchParams,
    updateUrl(search, { history, scroll, shallow }) {
      const url = location.pathname + renderQueryString(search) + location.hash

      if (shallow) {
        // The url only. Nothing on the server needs to know, so nothing is
        // fetched — but our own useSearchParams listens for this event rather
        // than for history changes, so it is told.
        window.history[history === 'push' ? 'pushState' : 'replaceState'](history === 'push' ? null : window.history.state, '', url)
        window.dispatchEvent(new CustomEvent('rsc-navigate', { detail: url }))

        if (scroll) window.scrollTo(0, 0)

        return
      }

      // A server component reads this query, so the page is refetched. The
      // promise is what keeps nuqs's isPending true until the new payload
      // has landed rather than until the url changed.
      //
      // Through router.ts rather than navigate.ts directly: client components
      // are built apart from the bootstrap, and importing the router module
      // here would put a second copy of it in this chunk.
      return visit(url as Href, { replace: history !== 'push' })
    },
  }
}

export const NuqsAdapter = createAdapterProvider(useRscKitAdapter)
