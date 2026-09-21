/**
 * The pictures a prefetched page shows, fetched before the click.
 *
 * A payload names them: every <img> the page renders is a row in it, src
 * and srcSet included. The page is rendered hidden on touch, and a hidden
 * page's images do load then - but a touch leads its click by a few hundred
 * milliseconds, and a product picture on a phone's connection takes
 * longer. The original of a port fetched the next page's image list from a
 * route as each link came into view; here the list is already in the
 * payload the router holds, so the images are asked for as it lands, at low
 * priority, and the click finds them decoded.
 *
 * Only the ones the page would load at once: an <img loading="lazy"> waits
 * for the viewport on the page too. Bounded per payload, and each url once
 * per document; nothing under Save-Data.
 */

const PER_PAGE = 24
/** Across the document: a home page with five hundred links in view is not five hundred pages of pictures. */
const PER_DOCUMENT = 400
const asked = new Set<string>()

export interface ImageProps {
  src?: string
  srcSet?: string
  sizes?: string
  loading?: string
  alt?: string
}

/** The props of every <img> element row in a flight payload, in order. */
export function imagesIn(payload: string): ImageProps[] {
  const found: ImageProps[] = []
  let at = 0

  while (found.length < PER_PAGE) {
    const start = payload.indexOf('["$","img",', at)

    if (start === -1) break

    // Past the key: `["$","img","key",{` or `["$","img",null,{`.
    const brace = payload.indexOf('{', start)

    if (brace === -1) break

    const end = closingBrace(payload, brace)

    at = end === -1 ? brace + 1 : end + 1

    if (end === -1) continue

    try {
      found.push(JSON.parse(payload.slice(brace, end + 1)) as ImageProps)
    } catch {
      // A props object with a reference in it that is not JSON; not a picture worth guessing at.
    }
  }

  return found
}

/** The index of the brace closing the object opened at `open`, honouring strings. */
function closingBrace(text: string, open: number): number {
  let depth = 0
  let inString = false

  for (let i = open; i < text.length; i++) {
    const c = text[i]

    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false

      continue
    }

    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }

  return -1
}

/** Ask the browser for the eager images a payload names, at low priority. */
export function preloadImages(payload: string): number {
  if (typeof document === 'undefined') return 0
  if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return 0

  let started = 0

  for (const props of imagesIn(payload)) {
    if (asked.size >= PER_DOCUMENT) break
    if (props.loading === 'lazy' || !props.src) continue

    const key = props.srcSet ?? props.src

    if (asked.has(key)) continue

    asked.add(key)

    const img = new Image()

    img.decoding = 'async'
    ;(img as { fetchPriority?: string }).fetchPriority = 'low'
    // sizes before srcset before src: the browser chooses on assignment.
    if (props.sizes) img.sizes = props.sizes
    if (props.srcSet) img.srcset = props.srcSet
    img.src = props.src
    started++
  }

  return started
}
