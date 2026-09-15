/**
 * Whether a newer build is live while this page is still running the old one.
 *
 * Free of React for the same reason onlineStore is: the value arrives from a
 * service worker message, which has nothing to do with rendering, and the hook
 * that reads it lives next door.
 *
 * The situation it reports is real rather than theoretical. This package's
 * worker activates immediately rather than waiting for every tab to close, and
 * activating sweeps the previous build's cache — so a page that has been open
 * across a deploy is running javascript whose remaining chunks are gone. It
 * works until it navigates somewhere that needs one.
 */

let updated = false
const listeners = new Set<() => void>()

/** A boolean, so React compares snapshots by value and does not loop. */
function announce(): void {
  if (updated) return

  updated = true
  listeners.forEach((fn) => fn())
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === 'rsc-kit:updated') announce()
  })

  // A worker that took control after this page loaded is the same news by
  // another route — it fires when the page was open across a deploy and the
  // message was posted before this listener existed.
  navigator.serviceWorker.addEventListener('controllerchange', announce)
}

export function isUpdated(): boolean {
  return updated
}

export function subscribeToUpdates(callback: () => void): () => void {
  listeners.add(callback)

  return () => listeners.delete(callback)
}

/** The server render's answer. A fresh document is by definition not stale. */
export function updatedOnServer(): boolean {
  return false
}
