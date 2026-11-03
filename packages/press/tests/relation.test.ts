import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { isActionValidationError } from '@rsc-kit/core/action'
import { saveRecord } from '../src/admin/actions'
import { memorySource } from '../src/memory'
import { definePanel } from '../src/admin/panel'
import { theme } from './theme'
import { defineResource, fieldsOf, valuesFrom } from '../src/resource'
import type { Tenant } from '../src/resource'
import { perTenant } from '../src/tenant'

/**
 * A belongsTo: a product's categoryId names a category. The form offers the
 * categories by title, the table shows the title, and the save takes only an
 * id the visitor could have picked - the browser sent it, so it is checked.
 */
type Category = { id: number; name: string }
type Product = { id: number; name: string; categoryId: number }

const acme: Tenant = { id: 'acme', name: 'Acme' }
const productForm = z.object({ name: z.string().min(1), categoryId: z.number().int() })

const categories = () =>
  defineResource<Category>()({
    name: 'categories',
    key: 'id',
    title: 'name',
    // Each tenant has its own: Acme's is id 1, Globex's id 2.
    source: perTenant((tenant) =>
      memorySource<Category, { name: string }>([tenant === 'acme' ? { id: 1, name: 'Lighting' } : { id: 2, name: 'Desks' }], 'id', (id, values) => ({ id, ...values })),
    ),
    table: (col) => [col.text('name')],
    form: z.object({ name: z.string() }),
  })

const products = (rows: Product[] = []) =>
  defineResource<Product>()({
    name: 'products',
    key: 'id',
    title: 'name',
    source: memorySource<Product, z.infer<typeof productForm>>(rows, 'id', (id, values) => ({ id, ...values })),
    table: (col) => [col.text('name'), col.relation('categoryId', 'categories')],
    form: productForm,
    fields: { categoryId: { relation: 'categories' } },
  })

const submit = (values: Record<string, string>) => {
  const data = new FormData()

  for (const [key, value] of Object.entries(values)) data.set(key, value)

  return data
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (isActionValidationError(error) ? error.errors : null),
  )

describe('a relation field', () => {
  test('is a select labelled for what it names, whose value is converted as a number field\'s is', () => {
    const [, category] = products().fields

    expect(category).toMatchObject({ name: 'categoryId', label: 'Category', type: 'select', relation: 'categories', numeric: true })
    expect(valuesFrom(products(), submit({ name: 'Lamp', categoryId: '1' }))).toEqual({ name: 'Lamp', categoryId: 1 })
  })

  test('and its column, titled for what it names', () => {
    expect(products().columns[1]).toMatchObject({ key: 'categoryId', label: 'Category', format: 'relation', relation: 'categories' })
  })

  test('naming a resource the panel does not have is refused when the panel is defined', () => {
    expect(() => definePanel({ theme, path: '/r1', resources: [products()] })).toThrow('products relates to categories, which is not a resource of this panel')
  })

  test('takes an id the visitor can see, and refuses another tenant\'s', async () => {
    const shop = products()

    definePanel({ theme, path: '/r2', resources: [shop, categories()], tenancy: { tenants: () => [acme], current: () => acme, switch: () => {} } })

    // Globex's category, posted by hand from an Acme session.
    expect(await refusal(saveRecord('/r2', 'products', null, submit({ name: 'Lamp', categoryId: '2' })))).toEqual({
      categoryId: ['Choose one of the listed categories.'],
    })
    expect((await shop.source.list({ dir: 'asc', page: 1, perPage: null, filters: {}, searchable: [] }, { tenant: acme })).total).toBe(0)

    await saveRecord('/r2', 'products', null, submit({ name: 'Lamp', categoryId: '1' })).catch(() => {})

    expect((await shop.source.list({ dir: 'asc', page: 1, perPage: null, filters: {}, searchable: [] }, { tenant: acme })).rows).toEqual([{ id: 1, name: 'Lamp', categoryId: 1 }])
  })
})

describe('an option', () => {
  test('from an enum reads as words, and one the app labelled keeps its label', () => {
    const schema = z.object({ status: z.enum(['in_stock', 'backOrdered']) })

    expect(fieldsOf(schema)[0]!.options).toEqual([
      { value: 'in_stock', label: 'In stock' },
      { value: 'backOrdered', label: 'Back ordered' },
    ])
    expect(fieldsOf(schema, { status: { options: ['in_stock', { value: 'backOrdered', label: 'On order' }] } })[0]!.options).toEqual([
      { value: 'in_stock', label: 'In stock' },
      { value: 'backOrdered', label: 'On order' },
    ])
  })
})
