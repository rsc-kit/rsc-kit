/**
 * Prefetching a link as it comes into view, where there is no pointer to hover it.
 *
 * On a phone the first signal a tap gives is touchstart, and the click lands
 * 100-300 ms after it - about a round trip - so a prefetch started there has
 * barely left when the navigation needs it. Next prefetches the links on
 * screen instead, and that is what makes its taps feel instant on a phone.
 * Only on a device with no hover: a pointer that can settle on a link is a
 * better signal than a link merely being visible, and cheaper on a page with
 * a hundred of them.
 *
 * One observer for every link, and the work is done when the browser is
 * idle - a list scrolled into view is many links at once, and the browser's
 * per-origin connections should not all be taken by pages nobody has tapped
 * yet. Each link prefetches once; the router keeps the payload for its TTL.
 */

let observer: IntersectionObserver | null = null
const pending = new WeakMap<Element, () => void>()

function noHover(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches
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
 * Prefetch when the link is on screen, on a device with no hover. Returns
 * the function that stops watching; a no-op where this does not apply.
 */
export function prefetchWhenVisible(element: Element | null, fire: () => void): () => void {
  if (!element || !noHover()) return () => {}

  const io = observerFor()

  if (!io) return () => {}

  pending.set(element, fire)
  io.observe(element)

  return () => {
    pending.delete(element)
    io.unobserve(element)
  }
}
