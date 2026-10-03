// The webhook changes the stock and says so. The section that declared the
// name is what the renderer refreshes; here is the half that is plain code.

import { describe, expect, test } from 'bun:test'
import { installVersionSource, versionSource } from '@rsc-kit/core/changed'
import { POST } from '../src/app/api/stock/restock/route'
import { restock, stockLeft } from '../src/app/webhook/store'

describe('the stock', () => {
  test('a restock adds to it', () => {
    const before = stockLeft().left

    restock(3)

    expect(stockLeft().left).toBe(before + 3)
  })
})

describe('the restock webhook', () => {
  test('answers 204, restocks, and moves the stock name', async () => {
    installVersionSource(null)

    const before = (await versionSource().changed({ stock: -1 }, 0)).stock ?? 0
    const left = stockLeft().left

    expect((await POST()).status).toBe(204)
    expect(stockLeft().left).toBe(left + 5)
    expect(await versionSource().changed({ stock: before }, 0)).toEqual({ stock: before + 1 })
  })
})
