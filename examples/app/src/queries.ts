'use server'

// Reads, as ordinary server functions.
//
// A client component calls these directly and a cache library holds the
// answers — there is no read-specific primitive here, and nothing in this
// package needs one: `"use server"` already gives a typed, endpoint-free call.

const catalogue = new Map([
  ['stay', ['Blue Lagoon cottage', 'Treasure Beach shack', 'Port Antonio villa']],
  ['experience', ['Rafting on the Rio Grande', 'Blue Mountain sunrise', 'Kingston food walk']],
])

export async function getListings(kind: string): Promise<string[]> {
  await new Promise((resolve) => setTimeout(resolve, 20))

  return catalogue.get(kind) ?? []
}

// A body of data big enough to page through.
const feed = Array.from({ length: 43 }, (_, i) => ({
  id: i + 1,
  title: `Listing ${i + 1}`,
  parish: ['Portland', 'St. Ann', 'Westmoreland', 'St. Thomas'][i % 4],
}))

export interface Page {
  items: typeof feed
  nextCursor: number | null
}

/** Cursor-paged, for infinite loading. The cursor is just an argument. */
export async function getFeed(cursor: number | null): Promise<Page> {
  await new Promise((resolve) => setTimeout(resolve, 300))

  const start = cursor ?? 0
  const items = feed.slice(start, start + 6)
  const next = start + 6

  return { items, nextCursor: next < feed.length ? next : null }
}

export interface NumberedPage {
  items: typeof feed
  page: number
  pageCount: number
}

/** Offset-paged, for page numbers. */
export async function getPage(page: number): Promise<NumberedPage> {
  await new Promise((resolve) => setTimeout(resolve, 300))

  const perPage = 8
  const start = (page - 1) * perPage

  return {
    items: feed.slice(start, start + perPage),
    page,
    pageCount: Math.ceil(feed.length / perPage),
  }
}

/**
 * Slow on purpose, so the streaming timeline is visible in a browser.
 *
 * Two regions with different delays, because the point is not that one boundary
 * fills late — it is that each fills on its own, in the same response, without
 * the slow one holding up the fast one or the shell.
 */
export async function getRegion(region: string): Promise<string[]> {
  const delay = region === 'north' ? 600 : 1_800

  await new Promise((resolve) => setTimeout(resolve, delay))

  return [
    `${region}: took ${delay}ms on the server`,
    `${region}: arrived in the page's own response`,
    `${region}: no request was made for this`,
  ]
}
