import { describe, expect, test } from 'bun:test'
import { cursorHref } from '../src/admin/url'
import { memorySource } from '../src/memory'
import type { DataSource } from '../src/resource'

describe('a list paged by cursor', () => {
  test('keeps the search, sort and filters the cursor was handed out for', () => {
    expect(cursorHref('/admin/orders', { q: 'lamp', sort: 'createdAt', dir: 'desc', filters: { status: 'open', empty: '' } }, 'eyJpZCI6OX0')).toBe(
      '/admin/orders?q=lamp&sort=createdAt&dir=desc&status=open&cursor=eyJpZCI6OX0',
    )
    // Ascending is the default, and a plain list carries the cursor alone.
    expect(cursorHref('/admin/orders', { dir: 'asc', filters: {} }, 'abc')).toBe('/admin/orders?cursor=abc')
  })

  test('is a source like a counted one: either answer types', async () => {
    const counted: DataSource<{ id: number }, never>['list'] = memorySource<{ id: number }, never>([{ id: 1 }], 'id', (id) => ({ id })).list
    const byCursor: DataSource<{ id: number }, never>['list'] = async (query) => ({ rows: [{ id: 2 }], next: null, prev: query.cursor ?? null })

    expect(await counted({ dir: 'asc', page: 1, perPage: 10, filters: {}, searchable: [] }, { tenant: null })).toEqual({ rows: [{ id: 1 }], total: 1 })
    expect(await byCursor({ dir: 'asc', page: 1, cursor: 'c1', perPage: 10, filters: {}, searchable: [] }, { tenant: null })).toEqual({
      rows: [{ id: 2 }],
      next: null,
      prev: 'c1',
    })
  })
})
