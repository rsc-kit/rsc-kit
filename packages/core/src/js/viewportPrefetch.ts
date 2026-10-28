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
 * yet.
 *
 * A link asks again each time it comes back into view, and when the tab is
 * visible again. The router keeps a payload for its TTL and ignores the ask
 * until then, so this is a request only for one that expired: a visitor who
 * read for a minute and scrolled back to the nav, or came back to the tab,
 * tapped a link whose payload was thirty seconds gone and waited a round trip
 * for it. Not on a timer: a page left open would refetch every link on it,
 * every thirty seconds, for nobody.
 */

let observer: IntersectionObserver | null = null
const fires = new WeakMap<Element, () => void>()
/** Links that have spent the page's budget, which asking again does not spend twice. */
const counted = new WeakSet<Element>()
/** On screen now, for the tab coming back. */
const inView = new Set<Element>()

/**
 * How many links a page prefetches on sight before the rest wait for
 * intent. A product page's payload is 30 KB with its related products,
 * and a listing shows twenty-four of them: on sight, every one, that was
 * three quarters of a megabyte per page on a phone. The first dozen in
 * view are fetched; a link past the budget is fetched on touch or on a
 * settled hover, a round trip before the click rather than before the
 * scroll. The budget is the page's, and starts again on each navigation.
 */
const ON_SIGHT_PER_PAGE = 12
let onSight = 0
let listening = false

function budgetPerPage(): void {
  if (listening || typeof window === "undefined") return

  listening = true
  window.addEventListener("rsc-navigate", () => {
    onSight = 0
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return

    for (const element of inView) {
      const fire = fires.get(element)

      if (fire && counted.has(element)) whenIdle(fire)
    }
  })
}

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
      for (const { isIntersecting, target } of entries) {
        if (!isIntersecting) {
          inView.delete(target)
          continue
        }

        inView.add(target)

        const fire = fires.get(target)

        if (!fire) continue

        if (!counted.has(target)) {
          if (onSight >= ON_SIGHT_PER_PAGE) continue

          onSight++
          counted.add(target)
        }

        whenIdle(fire)
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

  budgetPerPage()

  const io = observerFor()

  if (!io) return () => {}

  fires.set(element, fire)
  io.observe(element)

  return () => {
    fires.delete(element)
    inView.delete(element)
    io.unobserve(element)
  }
}
