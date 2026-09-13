'use server'

import { query } from '@rsc-kit/core/query'

// Reads, not writes. Declared with query() so they are reachable over GET —
// which is what lets an HTTP cache, a CDN or the service worker keep them, and
// what a POST to /_rsc/action could never offer.
//
// The module still carries 'use server': that is what registers them and gives
// each an id. query() adds the mark the GET endpoint checks before invoking
// anything, so the ordinary actions beside these stay POST-only.

const catalogue = new Map([
  ['stay', ['Blue Lagoon cottage', 'Treasure Beach shack', 'Port Antonio villa']],
  ['experience', ['Rafting on the Rio Grande', 'Blue Mountain sunrise', 'Kingston food walk']],
])

export const getListings = query(async (kind: string): Promise<string[]> => {
  // Where a real app would await its database.
  await new Promise((resolve) => setTimeout(resolve, 20))

  return catalogue.get(kind) ?? []
})

export const getListingCount = query(async (): Promise<number> => {
  await new Promise((resolve) => setTimeout(resolve, 20))

  return [...catalogue.values()].reduce((total, list) => total + list.length, 0)
})

/**
 * Slow on purpose, so the streaming timeline is visible in a browser.
 *
 * Two regions with different delays, because the point is not that one boundary
 * fills late — it is that each fills on its own, in the same response, without
 * the slow one holding up the fast one or the shell.
 */
export const getRegion = query(async (region: string): Promise<string[]> => {
  const delay = region === 'north' ? 600 : 1_800

  await new Promise((resolve) => setTimeout(resolve, delay))

  return [
    `${region}: took ${delay}ms on the server`,
    `${region}: arrived in the page's own response`,
    `${region}: no request was made for this`,
  ]
})

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

/**
 * Cursor-paged, for infinite loading.
 *
 * The cursor is an ordinary argument, so paging needs no second primitive —
 * each page is its own read, under its own key, cached and cacheable on its
 * own. `nextCursor: null` is what ends it.
 */
export const getFeed = query(async (cursor: number | null): Promise<Page> => {
  await new Promise((resolve) => setTimeout(resolve, 300))

  const start = cursor ?? 0
  const items = feed.slice(start, start + 6)
  const next = start + 6

  return { items, nextCursor: next < feed.length ? next : null }
})

export interface NumberedPage {
  items: typeof feed
  page: number
  pageCount: number
}

/** Offset-paged, for page numbers. */
export const getPage = query(async (page: number): Promise<NumberedPage> => {
  await new Promise((resolve) => setTimeout(resolve, 300))

  const perPage = 8
  const start = (page - 1) * perPage

  return {
    items: feed.slice(start, start + perPage),
    page,
    pageCount: Math.ceil(feed.length / perPage),
  }
})

let watched = 0

/**
 * Changes every time it is read, the way a seat count or a price would.
 *
 * Here to answer "do we need a live primitive?" — a read that can simply be
 * repeated already covers data that moves, and polling is what a cache library
 * does with refetchInterval.
 */
export const getSeatsLeft = query(async (): Promise<{ left: number; readAt: string }> => {
  watched += 1

  return { left: Math.max(0, 40 - watched), readAt: new Date().toISOString().slice(11, 23) }
})
