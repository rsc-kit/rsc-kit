import * as z from 'zod'
import { Tags } from 'lucide-react'
import { defineResource, memorySource, perTenant } from '@rsc-kit/admin'

export interface Category {
  id: number
  name: string
  slug: string
  visible: boolean
}

const form = z.object({
  name: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits and dashes'),
  visible: z.boolean(),
})

const seed = (): Category[] =>
  ['Furniture', 'Lighting', 'Electronics', 'Stationery', 'Storage', 'Decor', 'Accessories', 'Audio', 'Cables', 'Plants', 'Seating', 'Desks'].map(
    (name, index) => ({ id: index + 1, name, slug: name.toLowerCase(), visible: index % 5 !== 4 }),
  )

/**
 * Client mode: every row arrives once, and search, sort and paging happen in
 * the browser with no request. The table for data that stays small.
 */
export const categories = defineResource<Category>()({
  name: 'categories',
  key: 'id',
  title: 'name',
  icon: Tags,
  description: 'Loaded once and searched, sorted and paged in the browser: no request per keystroke.',
  mode: 'client',
  source: perTenant(() => memorySource(seed(), 'id', (id, values: z.infer<typeof form>) => ({ id, ...values }))),
  table: (col) => [col.text('name').searchable().sortable(), col.text('slug').searchable().sortable(), col.boolean('visible').sortable()],
  form,
  perPage: 5,
})
