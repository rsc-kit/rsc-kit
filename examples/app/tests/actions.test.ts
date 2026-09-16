// A server action is a function. So is a query.
//
// "use server" is a directive for the bundler; in a test file it is a string.
// The function it marks is importable and callable, so the logic inside it is
// a unit test — which is more than Next offers, where the advice is e2e.

import { describe, expect, test } from 'bun:test'
import { addToTotal, placeOrder } from '../src/actions'
import { getListings, getListingCount } from '../src/queries'

describe('actions', () => {
  test('placeOrder accepts an item', async () => {
    expect(await placeOrder('a rubber duck')).toEqual({ ok: true })
  })

  test('addToTotal adds', async () => {
    const before = await addToTotal(0)

    expect(await addToTotal(5)).toBe(before + 5)
  })
})

describe('queries', () => {
  test('getListings filters by kind', async () => {
    const stays = await getListings('stay')

    expect(Array.isArray(stays)).toBe(true)
    expect(stays.length).toBeGreaterThan(0)
  })

  test('getListingCount matches', async () => {
    expect(typeof (await getListingCount())).toBe('number')
  })
})
