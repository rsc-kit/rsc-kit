# @rsc-kit/press

Admin panels and public forms for [rsc-kit](https://rsc-kit.dev). You describe each resource once: its table, its form and where its rows come from. The package renders the list, create and edit pages for every resource from that, and a theme draws them. shadcn/ui is the theme that ships.

| Import | What it has |
| --- | --- |
| `@rsc-kit/press` | `defineResource`, `memorySource`, `perTenant`, `definePlugin`. Nothing here draws. |
| `@rsc-kit/press/admin` | `definePanel`, the url schemas its routes export, and the `AdminTheme` contract |
| `@rsc-kit/press/forms` | `defineForm`: a contact form, a sign-up or a survey from a Standard Schema, and the `FormsTheme` contract |
| `@rsc-kit/press/shadcn` | `shadcn`, the theme that draws both |
| `@rsc-kit/press/signing` | `verifyPluginRequest`, for an installable plugin's server |

```ts
// src/admin/resources/products.ts
import * as z from 'zod'
import { defineResource, memorySource } from '@rsc-kit/press'

const form = z.object({
  name: z.string().min(2),
  price: z.number().positive(),
  status: z.enum(['draft', 'active', 'archived']),
  featured: z.boolean().default(false),
})

export const products = defineResource<Product>()({
  name: 'products',
  key: 'id',
  title: 'name',
  source: memorySource<Product, z.infer<typeof form>>(seed, 'id', (id, values) => ({ id, ...values })),
  table: (col) => [col.text('name').searchable().sortable(), col.money('price').sortable(), col.badge('status')],
  filters: ['status'],
  form,
})
```

```ts
// src/admin/panel.ts
import { definePanel } from '@rsc-kit/press/admin'
import { shadcn } from '@rsc-kit/press/shadcn'
import { products } from './resources/products'

export default definePanel({
  path: '/admin',
  theme: shadcn,
  resources: [products],
  authorize: async () => (await currentUser())?.isAdmin === true,
})
```

The form is any Standard Schema - zod, valibot, arktype, Effect Schema - so the app uses the validator it already has. That one schema validates every save on the server, and decides which fields the form shows when it describes itself as JSON Schema (zod 4.2+ does); with any other, list the fields in `fields`. A refused save shows each error under its field and keeps what was typed.

## Mounting it

The engine finds routes, url schemas and sections by their files, so the panel is mounted with seven small route files:

```ts
// src/app/admin/middleware.ts
export default panel.middleware
// src/app/admin/layout.tsx
export default panel.Layout
// src/app/admin/page.tsx
export default panel.Dashboard

// src/app/admin/[resource]/page.tsx
export const params = resourceParams
export const searchParams = listSearch
export default panel.Index
// src/app/admin/[resource]/admin-table.section.tsx
export default panel.Table

// src/app/admin/[resource]/new/page.tsx
export const params = resourceParams
export default panel.Create
// src/app/admin/[resource]/[id]/page.tsx
export const params = recordParams
export default panel.Edit
```

Each file also imports `panel`, and imports `resourceParams`, `recordParams` and `listSearch` from `@rsc-kit/press/admin`.

## What you get

- **Search and filters** are a GET form on the list page. The table stays on screen while a query runs.
- **Sorting and paging** are held in the url, so a view can be bookmarked or shared.
- **Delete** refreshes only the table (`admin-table`). The search box keeps what was typed in it.
- **`authorize`** runs in the middleware, which answers a refusal with a real 404 before anything is sent. It runs again on every page and on every save and delete, because an action can be called without the page that rendered it.
- **Every panel page is rendered per request.** The build stores each page's skeleton and never runs `authorize` or a data source.

## Themes

A theme is an object of components: `Shell`, `Brand`, `TenantSwitcher`, `Nav`, `Breadcrumbs`, `UserMenu`, `Dashboard`, `Index`, `Table`, `Form`, `Plugins`, `Cell` and `Loading`. The panel decides what each page shows and who may see it, and hands the theme data, server actions already bound, and elements already drawn - never a component, so any of them may be a client component. To replace one page, spread the shipped theme: `theme: { ...shadcn, Dashboard: MyDashboard }`.

## Data sources

`memorySource` keeps rows in memory, for prototypes and tests. A database adapter is the same five functions:

```ts
interface DataSource<Row, Values> {
  list(query: ListQuery): Promise<{ rows: Row[]; total: number }>
  find(id: string): Promise<Row | null>
  create(values: Values): Promise<Row>
  update(id: string, values: Values): Promise<Row>
  delete(id: string): Promise<void>
}
```

## Server or client tables

`mode: 'server'` (the default) asks `list` for one page per search, filter, sort and page, and keeps the state in the url. `mode: 'client'` asks once with `perPage: null`, gets every row, and searches, sorts and pages in the browser - for small data.

## Auth, tenants and plugins

- `authorize` asks the app's own auth, on every page and every save, delete and switch. A refusal is a 404. `user` and `signOut` fill the sidebar's footer.
- `tenancy: { tenants, current, switch }` adds a team switcher, and every data source call is told `{ tenant }`. A tenant that is not the visitor's is refused.
- `plugins: [auditLog()]` adds resources, dashboard widgets and a reaction to every change. Writing, publishing and selling one: [Admin plugins](https://rsc-kit.dev/guides/admin-plugins/).

The shadcn theme needs Tailwind v4 and shadcn, and `@import "@rsc-kit/press/shadcn.css";` in the app's stylesheet. The full guide is [Admin panels](https://rsc-kit.dev/guides/admin/), and `examples/admin` is a panel over a per-team catalogue, a client-mode table and a REST API.
