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

/**
 * The worker's news is about the worker: a newer one took over. Whether
 * this PAGE is stale is a different question, and the server answers it -
 * a page loaded from the network while the new worker was still installing
 * is already the new build, and told to reload it reloaded into itself.
 * One request, with the build the document says it is: 409 is stale, 200
 * is current, and no answer at all is treated as stale, the safe reading.
 */
let confirming: Promise<void> | null = null

async function confirm(): Promise<void> {
  // One deploy is two signals - the worker's message and controllerchange
  // - and was two requests. One in flight at a time answers both.
  if (updated) return
  if (confirming) return confirming

  confirming = ask().finally(() => {
    confirming = null
  })

  return confirming
}

async function ask(): Promise<void> {
  const build = document.querySelector('meta[name="rsc-kit:build"]')?.getAttribute('content')

  if (!build) return announce()

  try {
    const response = await fetch(window.location.href, {
      method: 'HEAD',
      headers: { 'X-RSC': '1', 'X-RSC-Version': build },
      cache: 'no-store',
    })

    if (response.status === 409) announce()
  } catch {
    announce()
  }
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === 'rsc-kit:updated') void confirm()
  })

  // A worker that took control after this page loaded is the same news by
  // another route — it fires when the page was open across a deploy and the
  // message was posted before this listener existed. Only when a worker was
  // already in control when the page loaded: the first worker a visitor ever
  // gets claims the page too, and that is an install, not an update.
  const controlledAtLoad = navigator.serviceWorker.controller !== null

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlledAtLoad) void confirm()
  })
}

export function isUpdated(): boolean {
  return updated
}

/**
 * The server said so itself - a 409 to this page's build on a request the
 * visitor did not make. No confirmation needed: the answer is the
 * confirmation. The next navigation is a document load.
 */
export function markStale(): void {
  announce()
}

export function subscribeToUpdates(callback: () => void): () => void {
  listeners.add(callback)

  return () => listeners.delete(callback)
}

/** The server render's answer. A fresh document is by definition not stale. */
export function updatedOnServer(): boolean {
  return false
}
