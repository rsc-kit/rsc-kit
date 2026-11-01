import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { bulkRecords } from '../src/actions'
import { memorySource } from '../src/memory'
import { definePanel } from '../src/panel'
import { bulkToast, defineResource } from '../src/resource'
import type { BulkAction, Tenant } from '../src/resource'
import { perTenant } from '../src/tenant'

type Post = { id: number; title: string; published: boolean }

const acme: Tenant = { id: 'acme', name: 'Acme' }
const form = z.object({ title: z.string(), published: z.boolean() })
const everything = { dir: 'asc' as const, page: 1, perPage: null, filters: {}, searchable: [] }

/** Acme has posts 1-3; Globex has its own post 4. */
const posts = (bulkActions: BulkAction<Post>[] = []) =>
  defineResource<Post>()({
    name: 'posts',
    key: 'id',
    title: 'title',
    source: perTenant((tenant) =>
      memorySource<Post, z.infer<typeof form>>(
        tenant === 'acme'
          ? [1, 2, 3].map((id) => ({ id, title: `Post ${id}`, published: false }))
          : [{ id: 4, title: 'Theirs', published: false }],
        'id',
        (id, values) => ({ id, ...values }),
      ),
    ),
    table: (col) => [col.text('title')],
    form,
    bulkActions,
  })

const panel = (path: string, resource: ReturnType<typeof posts>, authorize = () => true) =>
  definePanel({ path, resources: [resource], authorize, tenancy: { tenants: () => [acme], current: () => acme, switch: () => {} } })

const ids = async (resource: ReturnType<typeof posts>) =>
  (await resource.source.list(everything, { tenant: acme })).rows.map((row) => row.id)

describe('a bulk action', () => {
  test('delete removes the ticked rows the visitor can see, and no others', async () => {
    const resource = posts()

    panel('/b1', resource)
    // 4 is Globex's, 9 does not exist: both are left alone.
    await bulkRecords('/b1', 'posts', 'delete', ['1', '3', '4', '9']).catch(() => {})

    expect(await ids(resource)).toEqual([2])
  })

  test('an app action is given the rows themselves', async () => {
    const given: Post[][] = []
    const resource = posts([{ name: 'publish', label: 'Publish', run: (rows) => void given.push(rows) }])

    panel('/b2', resource)
    await bulkRecords('/b2', 'posts', 'publish', ['2', '4']).catch(() => {})

    expect(given).toEqual([[{ id: 2, title: 'Post 2', published: false }]])
  })

  test('one the resource does not have is refused', async () => {
    const resource = posts()

    panel('/b3', resource)

    await expect(bulkRecords('/b3', 'posts', 'archive', ['1'])).rejects.toThrow('posts has no bulk action archive')
  })

  test('a visitor the panel refuses reaches nothing', async () => {
    const resource = posts()

    panel('/b4', resource, () => false)

    await expect(bulkRecords('/b4', 'posts', 'delete', ['1'])).rejects.toThrow('not allowed')
    expect(await ids(resource)).toEqual([1, 2, 3])
  })

  test('is refused on a read-only resource, and under the panel\'s own name', () => {
    expect(() =>
      defineResource<Post>()({
        name: 'logs', key: 'id', title: 'title', source: memorySource<Post, z.infer<typeof form>>([], 'id', (id, values) => ({ id, ...values })),
        table: (col) => [col.text('title')], form, readOnly: true, bulkActions: [{ name: 'x', label: 'X', run: () => {} }],
      }),
    ).toThrow('logs is read-only, so it has no bulk actions')
    expect(() => posts([{ name: 'delete', label: 'Remove', run: () => {} }])).toThrow("'delete' is the panel's own bulk action")
  })
})

describe('what a bulk action says when it is done', () => {
  test('what happened to the rows, when it says', () => {
    expect(bulkToast({ label: 'Publish', done: 'published' }, 3, 'products')).toBe('3 products published.')
    expect(bulkToast({ label: 'Delete', done: 'deleted' }, 1, 'product')).toBe('1 product deleted.')
  })

  test('its label and the count, when it does not', () => {
    expect(bulkToast({ label: 'Publish' }, 3, 'products')).toBe('Publish: 3 products.')
  })
})
