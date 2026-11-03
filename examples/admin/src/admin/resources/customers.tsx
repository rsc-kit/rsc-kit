import * as z from 'zod'
import { Users } from 'lucide-react'
import { defineResource } from '@rsc-kit/press'
import type { DataSource, ListQuery } from '@rsc-kit/press'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

/**
 * A resource whose rows live in someone else's API - here dummyjson.com, a
 * public fake REST API. The panel never knows: it calls the same five
 * functions it calls on a database. Writes are accepted and not kept there,
 * so a saved change does not show on the next load.
 */
export interface Customer {
  id: number
  firstName: string
  lastName: string
  email: string
  age: number
  gender: 'male' | 'female'
  role: 'admin' | 'moderator' | 'user'
  image: string
}

const API = 'https://dummyjson.com/users'
const FIELDS = 'id,firstName,lastName,email,age,gender,role,image'

const form = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.email(),
  age: z.number().int().min(18).max(120),
  gender: z.enum(['male', 'female']),
  role: z.enum(['admin', 'moderator', 'user']),
})

type Values = z.infer<typeof form>

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })

  if (!response.ok) throw new Error(`[customers] ${init?.method ?? 'GET'} ${url} answered ${response.status}`)

  return (await response.json()) as T
}

/**
 * The panel's query, in the API's words: q is its search, a filter its
 * key/value filter, sort and dir its sortBy and order, a page its skip.
 * This API cannot search and filter at once; a filter wins.
 */
function listUrl({ q, sort, dir, page, perPage, filters }: ListQuery): string {
  const [filter] = Object.entries(filters)
  const search = new URLSearchParams({ select: FIELDS, limit: String(perPage ?? 0), skip: String(perPage ? (page - 1) * perPage : 0) })

  if (sort) search.set('sortBy', sort), search.set('order', dir)

  if (filter) return `${API}/filter?${new URLSearchParams({ key: filter[0], value: filter[1] })}&${search}`
  if (q) return `${API}/search?${new URLSearchParams({ q })}&${search}`

  return `${API}?${search}`
}

const source: DataSource<Customer, Values> = {
  async list(query) {
    const { users, total } = await call<{ users: Customer[]; total: number }>(listUrl(query))

    return { rows: users, total }
  },
  async find(id) {
    const response = await fetch(`${API}/${encodeURIComponent(id)}?select=${FIELDS}`)

    return response.ok ? ((await response.json()) as Customer) : null
  },
  create: (values) => call<Customer>(`${API}/add`, { method: 'POST', body: JSON.stringify(values) }),
  update: (id, values) => call<Customer>(`${API}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(values) }),
  async delete(id) {
    await call(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
}

export const customers = defineResource<Customer>()({
  name: 'customers',
  key: 'id',
  title: 'email',
  icon: Users,
  description: 'From an external REST API (dummyjson.com): the source is five fetch calls.',
  source,
  table: (col) => [
    // A cell of your own: the app's shadcn Avatar, drawn on the server.
    col.text('image').label('').cell((src: string, row: Customer) => (
      <Avatar className="size-8">
        <AvatarImage src={src} alt="" />
        <AvatarFallback>{row.firstName.charAt(0)}</AvatarFallback>
      </Avatar>
    )),
    col.text('firstName').label('First name').searchable().sortable(),
    col.text('lastName').label('Last name').sortable(),
    col.text('email').searchable(),
    col.text('age').sortable(),
    col.badge('role'),
    col.badge('gender').hidden(),
  ],
  filters: ['role', 'gender'],
  form,
  perPage: 10,
})
