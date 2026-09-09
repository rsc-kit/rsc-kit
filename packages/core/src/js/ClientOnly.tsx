'use client'

// Rendering something the server has no answer for.
//
// The trap this exists for is not obvious, because the two halves look
// unrelated. A page frozen at build time still hydrates: the HTML is markup,
// and every client component in it re-runs in the browser so React can attach
// its handlers. So a value read during that render — the clock, the viewport,
// anything from `window` — is produced twice, once by the build and once by
// the browser, and React reports the two not matching. Freezing makes it
// worse rather than better: the gap is not milliseconds but however long ago
// the build ran.
//
//   <ClientOnly fallback={<span>—</span>}>
//     <Clock />
//   </ClientOnly>
//
// react-dom documents a `browser` api for this, which does it properly by
// leaving a Suspense fallback in the HTML. It is not in 19.2, which is what an
// app installs today; when it is, this becomes a thin wrapper over it.
//
// useSyncExternalStore rather than useState in an effect, because the server
// snapshot is exactly the thing being expressed: React renders the fallback on
// the server, renders it again during hydration so the two agree, and only
// then switches. An effect gets there too, one render later and with a
// lifecycle to reason about.

import { useSyncExternalStore, type ReactNode } from 'react'

/** Nothing to subscribe to: the answer changes once, when React hydrates. */
const subscribe = () => () => {}
const inBrowser = () => true
const onServer = () => false

export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode
  /** Rendered on the server and during hydration. Both must agree. */
  fallback?: ReactNode
}): ReactNode {
  return useSyncExternalStore(subscribe, inBrowser, onServer) ? children : fallback
}
