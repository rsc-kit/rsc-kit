import * as z from 'zod'
import { Package } from 'lucide-react'
import { defineResource, memorySource, perTenant } from '@rsc-kit/admin'

export interface Product {
  id: number
  name: string
  sku: string
  price: number
  stock: number
  status: 'draft' | 'active' | 'archived'
  featured: boolean
  description?: string
}

const form = z.object({
  name: z.string().min(2, 'At least two characters'),
  sku: z.string().regex(/^[A-Z]{3}-\d{3}$/, 'Like ABC-123'),
  price: z.number().positive('More than zero'),
  stock: z.number().int().min(0),
  status: z.enum(['draft', 'active', 'archived']),
  featured: z.boolean(),
  description: z.string().max(500).optional(),
})

const names = ['Desk lamp', 'Standing desk', 'Office chair', 'Monitor arm', 'Keyboard', 'Mouse', 'Webcam', 'Headphones', 'Notebook', 'Pen set', 'Bookshelf', 'Plant pot', 'Cable tray', 'Footrest', 'Whiteboard', 'Coat rack', 'Desk mat', 'USB hub', 'Speaker', 'Wall clock']
const statuses = ['draft', 'active', 'archived'] as const

/** Each team starts with its own catalogue, so switching teams shows a different table. */
function seed(team: string): Product[] {
  const offset = team.length

  return names.slice(0, 12 + (offset % 8)).map((name, index) => ({
    id: index + 1,
    name: `${name}`,
    sku: `${team.slice(0, 3).toUpperCase()}-${String(100 + index * 7).padStart(3, '0')}`,
    price: Math.round((19 + ((index * 37 + offset * 11) % 480)) * 100) / 100,
    stock: (index * 13 + offset) % 60,
    status: statuses[(index + offset) % 3]!,
    featured: index % 4 === 0,
  }))
}

/**
 * Server mode: each search, filter, sort and page is a request, and the
 * source returns one page. The table for data that grows.
 */
export const products = defineResource<Product>()({
  name: 'products',
  key: 'id',
  title: 'name',
  icon: Package,
  description: 'Searched, sorted and paged on the server: each change is a request for one page.',
  source: perTenant((team) => memorySource(seed(team), 'id', (id, values: z.infer<typeof form>) => ({ id, ...values }))),
  table: (col) => [
    col.text('name').searchable().sortable(),
    col.text('sku').label('SKU').searchable(),
    col.money('price').sortable(),
    col.text('stock').sortable(),
    col.badge('status'),
    col.boolean('featured').hidden(),
  ],
  filters: ['status'],
  form,
  fields: { description: { type: 'textarea', description: 'Shown on the product page. Up to 500 characters.' } },
  perPage: 8,
})
