/**
 * Prefetching a link as it comes into view.
 *
 * A navigation is as fast as what is already in the browser when the click
 * lands, and a hover is too late to fetch that: a pointer that has settled
 * on a link is 200-300 ms from clicking it, and on a phone the first signal
 * is touchstart, 100-300 ms before the click - about a round trip either
 * way, so a fetch started there has barely left when the navigation needs
 * it. Next prefetches the links on screen instead, and that is what makes
 * its clicks feel like a single-page app's: the payload was there before
 * the pointer moved. So, on every device, the links on screen are fetched -
 * the bytes only; decoding a payload loads the chunks it names, and that
 * waits for the hover or the touch that says which link is meant. It used
 * to be phones only, with a hover-capable device left to the hover: a click
 * that came quicker than the round trip waited for it, and desktop was
 * fast but not instant.
 *
 * Not when the visitor asked for less data: Save-Data is the one signal a
 * browser gives that speculative requests are unwelcome.
 *
 * One observer for every link, and the work is done when the browser is
 * idle - a list scrolled into view is many links at once, and the browser's
 * per-origin connections should not all be taken by pages nobody has tapped
 * yet. Each link prefetches once; the router keeps the payload for its TTL.
 */

let observer: IntersectionObserver | null = null
const pending = new WeakMap<Element, () => void>()

function savingData(): boolean {
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection

  return connection?.saveData === true
}

function whenIdle(fn: () => void): void {
  const idle = (window as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => void }).requestIdleCallback

  if (idle) idle(fn, { timeout: 1000 })
  else setTimeout(fn, 50)
}

function observerFor(): IntersectionObserver | null {
  if (observer) return observer
  if (typeof IntersectionObserver === "undefined") return null

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue

        const fire = pending.get(entry.target)

        observer!.unobserve(entry.target)
        pending.delete(entry.target)

        if (fire) whenIdle(fire)
      }
    },
    // A little ahead of the fold: a link about to scroll into view is one
    // about to be tapped.
    { rootMargin: "200px" },
  )

  return observer
}

/**
 * Prefetch when the link is on screen. Returns the function that stops
 * watching; a no-op where this does not apply.
 */
export function prefetchWhenVisible(element: Element | null, fire: () => void): () => void {
  if (!element || savingData()) return () => {}

  const io = observerFor()

  if (!io) return () => {}

  pending.set(element, fire)
  io.observe(element)

  return () => {
    pending.delete(element)
    io.unobserve(element)
  }
}
