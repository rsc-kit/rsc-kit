/**
 * fetchQuery's second argument is the query's own parameter list.
 *
 * Not a .test.ts: nothing to assert at runtime. What it pins is that a wrong
 * key in the arguments fails the typecheck rather than the read — the tuple
 * used to be `unknown[]`, so `fetchQuery(status, [{ id }])` against a query
 * wanting `{ restorationId }` compiled and then read nothing, silently.
 *
 * `bun run typecheck` is what runs it.
 */
import { fetchQuery } from '../../src/js/queryClient'

declare const jobStatus: (input: { restorationId: string }) => Promise<{ status: string }>
declare const getSeats: () => Promise<number>

export const typed: Promise<{ status: string }> = fetchQuery(jobStatus, [{ restorationId: 'x' }])

// A query that takes nothing needs no tuple, and accepts the empty one.
export const bare: Promise<number> = fetchQuery(getSeats)
export const empty: Promise<number> = fetchQuery(getSeats, [])

// @ts-expect-error a key the query does not take
fetchQuery(jobStatus, [{ id: 'x' }])

// @ts-expect-error a query with a parameter cannot be read without it
fetchQuery(jobStatus)
