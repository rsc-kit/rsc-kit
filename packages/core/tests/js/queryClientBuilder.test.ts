// A read on the action client.
//
// The reason it lives there rather than on a client of its own: an app writes
// its auth check and its error reporting once, and both a mutation and a read
// go through them. A second builder would mean two copies to keep in step, and
// the one that drifts is the one nobody is looking at.

import { describe, expect, test } from 'bun:test'
import { createActionClient } from '../../src/action'
import { isQuery, isQueryValidationError, queryCacheControl } from '../../src/query'
import type { StandardSchemaV1 } from '../../src/js/standardSchema'

/** A schema without pulling a library in. */
const kind: StandardSchemaV1 = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value: unknown) => {
      const k = (value as { kind?: unknown })?.kind

      return k === 'stay' || k === 'experience'
        ? { value: { kind: k } }
        : { issues: [{ message: 'must be stay or experience', path: ['kind'] }] }
    },
  },
}

const client = createActionClient({ onError: () => 'Something went wrong.' })

describe('a read on the action client', () => {
  test('is marked a query, so the GET endpoint will run it', () => {
    const read = client.query(async () => 'ok')

    expect(isQuery(read)).toBe(true)
  })

  test('returns the data directly rather than an action result', async () => {
    // An action answers { data }, because React serialises a rejection
    // opaquely. A read is handed to a cache library as a fetcher, and those
    // expect the value.
    const read = client.query(async () => ({ items: [1, 2] }))

    expect(await read()).toEqual({ items: [1, 2] })
  })

  test('runs the same middleware a mutation would', async () => {
    const ran: string[] = []

    const authed = createActionClient().use(async ({ next }) => {
      ran.push('middleware')

      return next({ ctx: { user: 'ada' } })
    })

    const read = authed.query(async ({ ctx }) => (ctx as { user: string }).user)

    expect(await read()).toBe('ada')
    expect(ran).toEqual(['middleware'])
  })

  test('a middleware that refuses stops the read', async () => {
    const guarded = createActionClient({ onError: () => 'Not allowed.' }).use(async () => {
      throw new Error('nope')
    })

    const read = guarded.query(async () => 'never reached')

    // The message is the one onError chose, not the thrown one — the same
    // sanitising an action gets.
    expect(read()).rejects.toThrow('Not allowed.')
  })

  test('validates with the same schema, and throws with the fields intact', async () => {
    const read = client.input(kind).query(async ({ input }) => input)

    expect(await read({ kind: 'stay' })).toEqual({ kind: 'stay' })

    try {
      await read({ kind: 'nonsense' })
      throw new Error('should have refused')
    } catch (error) {
      // Thrown rather than returned, because every cache library reports
      // failure by rejection — but carrying the fields a form needs.
      expect(isQueryValidationError(error)).toBe(true)
      expect((error as { errors: Record<string, string[]> }).errors).toEqual({
        kind: ['must be stay or experience'],
      })
    }
  })

  test('takes cache options, like any other query', () => {
    const read = client.query(async () => 1, { cache: 'public', maxAge: 60 })

    expect(queryCacheControl(read)).toBe('public, max-age=60')
  })
})

describe('the mutation terminal is unchanged', () => {
  test('still returns its failures rather than throwing them', async () => {
    const write = client.input(kind).handler(async ({ input }) => input)

    expect(await write({ kind: 'stay' })).toEqual({ data: { kind: 'stay' } })
    expect(await write({ kind: 'nonsense' })).toEqual({
      validationErrors: { kind: ['must be stay or experience'] },
    })
  })

  test('and still reports an unexpected throw through onError', async () => {
    const write = client.handler(async () => {
      throw new Error('a database fell over')
    })

    expect(await write()).toEqual({ serverError: 'Something went wrong.' })
  })
})
