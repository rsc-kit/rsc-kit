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
