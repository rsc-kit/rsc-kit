import { cache } from '@rsc-kit/core/cache'

// Stands in for a session lookup. Counted so the example can show the memo
// working: a real one would be a query, and the point is that it happens once
// per request however many times it is asked for.
let lookups = 0

/** Set per request by the server entry. There is none at build time. */
export let signedIn = false

export function setSignedIn(value: boolean): void {
  signedIn = value
}

export const currentUser = cache(async () => {
  lookups++
  await new Promise((r) => setTimeout(r, 5))

  return signedIn ? { name: 'Ada', lookups } : null
})

export function lookupCount(): number {
  return lookups
}
