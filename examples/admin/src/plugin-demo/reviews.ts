import type { PluginManifest, PluginRequest } from '@rsc-kit/press'
import { verifyPluginRequest } from '@rsc-kit/press/signing'

/**
 * A plugin, served by this example so the demo needs one process. Nothing
 * about it depends on that: it is reached by url, over signed HTTP, exactly
 * as one on another server would be, and it imports nothing of the panel's
 * but the signature check. Its rows are its own; of the app's, it sees what
 * read:products grants - the product a review names, and changes to products.
 */
export function manifest(origin: string): PluginManifest {
  return {
    name: 'product-reviews',
    label: 'Product reviews',
    description: 'Reviews of your products, moderated before they are shown.',
    version: '1.0.0',
    endpoint: `${origin}/demo-plugin/rpc`,
    scopes: ['read:products'],
    resources: [
      {
        name: 'reviews',
        singular: 'Review',
        key: 'id',
        title: 'author',
        description: 'Kept by the Product reviews plugin, on its own server.',
        columns: [
          { key: 'author', searchable: true },
          { key: 'productId', relation: 'products', label: 'Product' },
          { key: 'rating' },
          { key: 'status', format: 'badge' },
        ],
        form: {
          type: 'object',
          required: ['author', 'productId', 'rating', 'status'],
          properties: {
            author: { type: 'string', minLength: 2, maxLength: 60 },
            productId: { type: 'string', relation: 'products', title: 'Product' },
            rating: { type: 'integer', minimum: 1, maximum: 5 },
            status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            body: { type: 'string', format: 'textarea', maxLength: 2000, title: 'Review' },
          },
        },
        filters: ['status'],
        bulkActions: [{ name: 'approve', label: 'Approve', done: 'approved' }],
      },
    ],
    events: ['products'],
  }
}

type Review = { id: string; author: string; productId: string; rating: number; status: string; body?: string }

/** The plugin's own storage: by installation, which is by tenant. On globalThis to survive a dev reload. */
const state = ((globalThis as Record<symbol, unknown>)[Symbol.for('demo-plugin.reviews')] ??= {
  secrets: new Map<string, string>(),
  reviews: new Map<string, Review[]>(),
  told: [] as string[],
}) as { secrets: Map<string, string>; reviews: Map<string, Review[]>; told: string[] }

/** The plugin's settings: where the person installing pastes what the panel showed them. */
export function connect(installation: string, secret: string): void {
  state.secrets.set(installation, secret)
}

export function connected(): string[] {
  return [...state.secrets.keys()]
}

export function told(): string[] {
  return state.told.slice(-5)
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

export async function answer(request: Request): Promise<Response> {
  const verified = await verifyPluginRequest<PluginRequest>(request, (id) => state.secrets.get(id))

  if (!verified) return new Response(null, { status: 401 })

  const call = verified.body
  const rows = state.reviews.get(verified.installation) ?? []

  state.reviews.set(verified.installation, rows)

  switch (call.type) {
    case 'list': {
      const { q, filters, sort, dir, page, perPage } = call.query
      let found = rows.filter((row) => (!q || row.author.toLowerCase().includes(q.toLowerCase())) && (!filters.status || row.status === filters.status))

      if (sort) found = [...found].sort((a, b) => String(a[sort as keyof Review]).localeCompare(String(b[sort as keyof Review])) * (dir === 'desc' ? -1 : 1))

      return json({ rows: perPage === null ? found : found.slice((page - 1) * perPage, page * perPage), total: found.length })
    }
    case 'find': {
      const row = rows.find((candidate) => candidate.id === call.id)

      return row ? json({ row }) : new Response(null, { status: 404 })
    }
    case 'create':
    case 'update': {
      const values = call.values as Omit<Review, 'id'>

      // A rule only the plugin knows, answered as the panel's forms expect.
      if (/https?:\/\//.test(values.body ?? '')) return json({ errors: { body: ['Links are not allowed in a review.'] } }, 422)

      if (call.type === 'create') {
        const row = { id: crypto.randomUUID().slice(0, 8), ...values }

        rows.push(row)

        return json({ row })
      }

      const index = rows.findIndex((candidate) => candidate.id === call.id)

      if (index < 0) return new Response(null, { status: 404 })

      rows[index] = { id: call.id, ...values }

      return json({ row: rows[index] })
    }
    case 'delete':
      state.reviews.set(verified.installation, rows.filter((row) => row.id !== call.id))

      return json({})
    case 'bulk':
      for (const row of rows) if (call.ids.includes(row.id)) row.status = 'approved'

      return json({})
    case 'change':
      state.told.push(`${call.change.resource} ${call.change.id} ${call.change.change}`)

      return json({})
  }
}
