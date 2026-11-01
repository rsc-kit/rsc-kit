import * as z from 'zod'
import { defineResource, memorySource } from '../kit'

export interface Product {
  id: number
  name: string
  sku: string
  price: number
  stock: number
  status: 'draft' | 'active' | 'archived'
  featured: boolean
  description: string
}

const seed: Product[] = Array.from({ length: 27 }, (_, i) => ({
  id: i + 1,
  name: ['Rubber duck', 'Desk lamp', 'Notebook', 'Mechanical pencil', 'Mug', 'Plant pot', 'Headphones', 'Cable tidy', 'Stapler'][i % 9]! + (i >= 9 ? ` ${Math.floor(i / 9) + 1}` : ''),
  sku: `SKU-${String(1000 + i)}`,
  price: 4 + ((i * 37) % 120),
  stock: (i * 13) % 60,
  status: (['active', 'draft', 'archived', 'active'] as const)[i % 4]!,
  featured: i % 5 === 0,
  description: '',
}))

/** The form, and the check every save goes through. */
const form = z.object({
  name: z.string().min(2, 'At least two characters'),
  sku: z.string().regex(/^SKU-\d{4}$/, 'Like SKU-1234'),
  price: z.coerce.number().positive('More than zero'),
  stock: z.coerce.number().int().min(0),
  status: z.enum(['draft', 'active', 'archived']),
  featured: z.boolean().default(false),
  description: z.string().optional(),
})

export const products = defineResource<Product>()({
  name: 'products',
  key: 'id',
  title: 'name',
  source: memorySource<Product, z.infer<typeof form>>(seed, 'id', (id, values) => ({ id, ...values, description: values.description ?? '' })),

  table: (col) => [
    col.text('name').searchable().sortable(),
    col.text('sku').searchable().label('SKU'),
    col.money('price').sortable(),
    col.text('stock').sortable(),
    col.badge('status'),
    col.boolean('featured'),
  ],

  filters: ['status'],

  form,

  fields: { description: { type: 'textarea' } },
})
