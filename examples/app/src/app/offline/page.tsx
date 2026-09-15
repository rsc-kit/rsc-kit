import type { Metadata } from '@rsc-kit/core/metadata'

export const metadata: Metadata = { title: 'Offline' }

// An ordinary route. What makes it the fallback is that the build stored it and
// the worker precached it — not anything in this file.
export default function OfflinePage() {
  return (
    <main>
      <h1>You are offline</h1>
      <p>This page was stored when you last had a connection. Try again once you are back.</p>
    </main>
  )
}
