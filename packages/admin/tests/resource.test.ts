import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { defineResource, fieldsOf, parse } from '../src/resource'
import { memorySource } from '../src/memory'

/** A panel without tenants: what every data source call is told. */
const none = { tenant: null }

interface Product {
  id: number
  name: string
  price: number
  status: 'draft' | 'active'
  featured: boolean
  note?: string
}

const form = z.object({
  name: z.string().min(2),
  // Not z.coerce: the form turns a number field's text into a number itself.
  price: z.number().positive(),
  status: z.enum(['draft', 'active']),
  featured: z.boolean().default(false),
  note: z.string().optional(),
})

const rows = (): Product[] => [
  { id: 1, name: 'Lamp', price: 30, status: 'active', featured: false },
  { id: 2, name: 'Desk', price: 200, status: 'draft', featured: true },
  { id: 3, name: 'Desk lamp', price: 45, status: 'active', featured: false },
]

const products = (data = rows()) =>
  defineResource<Product>()({
    name: 'products',
    key: 'id',
    title: 'name',
    source: memorySource<Product, z.infer<typeof form>>(data, 'id', (id, values) => ({ id, ...values })),
    table: (col) => [col.text('name').searchable().sortable(), col.money('price').sortable(), col.badge('status')],
    filters: ['status'],
    form,
    fields: { note: { type: 'textarea' } },
  })

describe('a schema read for its fields', () => {
  test('each type is the control it needs, and a wrapped one is not required', () => {
    expect(fieldsOf(form, { note: { type: 'textarea' } })).toEqual([
      { name: 'name', label: 'Name', type: 'text', required: true, minLength: 2 },
      { name: 'price', label: 'Price', type: 'number', required: true, step: 'any' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: ['draft', 'active'] },
      { name: 'featured', label: 'Featured', type: 'toggle', required: false },
      { name: 'note', label: 'Note', type: 'textarea', required: false },
    ])
  })
})

describe('a resource', () => {
  test('takes its labels from its name, and its columns from the table', () => {
    const resource = products()

    expect([resource.label, resource.singular]).toEqual(['Products', 'Product'])
    expect(resource.columns.map((c) => [c.key, c.format, c.sortable, c.searchable])).toEqual([
      ['name', 'text', true, true],
      ['price', 'money', true, false],
      ['status', 'badge', false, false],
    ])
    expect(resource.filters).toEqual([{ key: 'status', label: 'Status', options: ['draft', 'active'] }])
  })

  test('a filter on a field that is not an enum is refused when defined', () => {
    expect(() =>
      defineResource<Product>()({ name: 'p', key: 'id', title: 'name', source: products().source, table: () => [], filters: ['name'], form }),
    ).toThrow('the filter name needs an enum field')
  })

  test('a name that is not a url segment is refused', () => {
    expect(() => defineResource<Product>()({ name: 'Products', key: 'id', title: 'name', source: products().source, table: () => [], form })).toThrow(
      'url segment',
    )
  })
})

describe('a submitted form', () => {
  const submit = (entries: Record<string, string>) => {
    const data = new FormData()

    for (const [name, value] of Object.entries(entries)) data.set(name, value)

    return parse(products(), data)
  }

  test('is checked by the schema, a toggle that is off is false, and an empty optional field is absent', async () => {
    expect(await submit({ name: 'Chair', price: '12.5', status: 'draft', note: '' })).toEqual({
      ok: true,
      values: { name: 'Chair', price: 12.5, status: 'draft', featured: false },
    })
    expect(await submit({ name: 'Chair', price: '1', status: 'active', featured: 'on' })).toMatchObject({ ok: true, values: { featured: true } })
  })

  test('a refusal is under the field it is about, and text in a number field is the schema\'s to refuse', async () => {
    expect(Object.keys(((await submit({ name: 'Chair', price: 'abc', status: 'draft' })) as { errors: object }).errors)).toEqual(['price'])

    const parsed = await submit({ name: 'C', price: '-1', status: 'draft' })

    expect(parsed.ok).toBe(false)
    expect(Object.keys((parsed as { errors: Record<string, string[]> }).errors).sort()).toEqual(['name', 'price'])
  })
})

describe('the memory source', () => {
  const list = (over: Partial<Parameters<ReturnType<typeof products>['source']['list']>[0]> = {}) =>
    products().source.list({ dir: 'asc', page: 1, perPage: 10, filters: {}, searchable: ['name'], ...over }, none)

  test('searches the searchable columns, filters, sorts and pages', async () => {
    expect((await list({ q: 'LAMP' })).rows.map((r) => r.id)).toEqual([1, 3])
    expect((await list({ filters: { status: 'draft' } })).rows.map((r) => r.id)).toEqual([2])
    expect((await list({ sort: 'price', dir: 'desc' })).rows.map((r) => r.id)).toEqual([2, 3, 1])
    expect((await list({ sort: 'name' })).rows.map((r) => r.name)).toEqual(['Desk', 'Desk lamp', 'Lamp'])
    expect(await list({ perPage: 2, page: 2 })).toEqual({ rows: [expect.objectContaining({ id: 3 })], total: 3 })
    // A client-mode table asks for every row, and gets them unpaged.
    expect((await list({ perPage: null, page: 1 })).rows).toHaveLength(3)
  })

  test('creates, updates and deletes', async () => {
    const source = products().source
    const made = await source.create({ name: 'Chair', price: 5, status: 'draft', featured: false }, none)

    expect(made.id).toBe(4)
    expect((await source.update('4', { name: 'Stool', price: 6, status: 'active', featured: true }, none)).name).toBe('Stool')
    await source.delete('4', none)
    expect(await source.find('4', none)).toBeNull()
    await expect(source.update('99', { name: 'x', price: 1, status: 'draft', featured: false }, none)).rejects.toThrow('no row 99')
  })
})

describe('any Standard Schema', () => {
  /** A schema from no library: it validates, and cannot say what its fields are. */
  const bare = {
    '~standard': {
      version: 1 as const,
      vendor: 'bare',
      validate: (value: unknown) => {
        const { title } = value as { title?: unknown }

        return typeof title === 'string' && title.length > 0 ? { value: { title } } : { issues: [{ message: 'A title', path: ['title'] }] }
      },
      types: undefined as unknown as { input: { title: string }; output: { title: string } },
    },
  }

  const notes = (fields?: Record<string, object>) =>
    defineResource<{ id: number; title: string }>()({
      name: 'notes',
      key: 'id',
      title: 'title',
      source: memorySource([], 'id', (id, values: { title: string }) => ({ id, ...values })),
      table: (col) => [col.text('title')],
      form: bare,
      ...(fields ? { fields } : {}),
    })

  test('one that does not describe its fields must list them, and is told so', () => {
    expect(() => notes()).toThrow('bare schema does not describe its fields as JSON Schema')
    expect(notes({ title: { type: 'textarea' } }).fields).toEqual([{ name: 'title', label: 'Title', type: 'textarea', required: true }])
  })

  test('validates a save, whatever made it', async () => {
    const empty = new FormData()
    const given = new FormData()

    given.set('title', 'Hello')

    expect(await parse(notes({ title: {} }), empty)).toEqual({ ok: false, errors: { title: ['A title'] } })
    expect(await parse(notes({ title: {} }), given)).toEqual({ ok: true, values: { title: 'Hello' } })
  })
})

describe('what the browser checks', () => {
  const field = (name: string, schema: z.ZodObject, fields?: Record<string, object>) =>
    fieldsOf(schema, fields).find((f) => f.name === name)!

  test('lengths, ranges and an integer\'s step come from the schema', () => {
    const schema = z.object({ name: z.string().min(2).max(40), age: z.number().int().min(18).max(120), price: z.number().positive() })

    expect(field('name', schema)).toMatchObject({ minLength: 2, maxLength: 40 })
    expect(field('age', schema)).toMatchObject({ min: 18, max: 120, step: 1 })
    // positive() is exclusive, which min= cannot say; the server refuses 0.
    expect(field('price', schema)).toMatchObject({ step: 'any' })
    expect(field('price', schema).min).toBeUndefined()
  })

  test('only an anchored pattern the v flag compiles becomes the pattern attribute', () => {
    const schema = z.object({
      sku: z.string().regex(/^[A-Z]{3}-\d{3}$/),
      contains: z.string().regex(/abc/),
      slug: z.string().regex(/^[a-z0-9-]+$/),
      email: z.email(),
    })

    expect(field('sku', schema).pattern).toBe('^[A-Z]{3}-\\d{3}$')
    expect(field('contains', schema).pattern).toBeUndefined()
    expect(field('slug', schema).pattern).toBeUndefined()
    expect(field('email', schema).pattern).toBeUndefined()
  })

  test('a string made a textarea keeps its lengths and has no pattern', () => {
    const schema = z.object({ note: z.string().max(500).regex(/^x+$/) })

    expect(field('note', schema, { note: { type: 'textarea' } })).toMatchObject({ type: 'textarea', maxLength: 500 })
    expect(field('note', schema, { note: { type: 'textarea' } }).pattern).toBeUndefined()
  })
})
