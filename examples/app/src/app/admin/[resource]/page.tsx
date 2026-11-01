import * as z from 'zod'
import Form from '@rsc-kit/core/form'
import Link from '@rsc-kit/core/Link'
import { notFound } from '@rsc-kit/core/not-found'
import type { PageProps } from '@rsc-kit/core/route-schema'
import { resource } from '../../../admin/registry'
import { listSearch } from './query'
import ResourceTable from './admin-table.section'

export const params = z.object({ resource: z.string() })
export const searchParams = listSearch

export default async function ResourceIndex({ params: p, searchParams: s }: PageProps<typeof params, typeof searchParams>) {
  const { resource: name } = await p
  const query = await s
  const target = resource(name)

  if (!target) notFound()

  return (
    <>
      <h1>{target.label}</h1>
      <div className="admin-bar">
        {/* A search on the page it is on: the table stays up while the query runs. */}
        <Form action={`/admin/${name}`} method="get">
          <input name="q" placeholder="Search" defaultValue={query.q ?? ''} />
          {target.filters.map((filter) => (
            <select key={filter.key} name={filter.key} defaultValue={String(query[filter.key] ?? '')}>
              <option value="">All {filter.label.toLowerCase()}</option>
              {filter.options.map((option) => <option key={option}>{option}</option>)}
            </select>
          ))}
          <button>Filter</button>
        </Form>
        <Link href={`/admin/${name}/new` as never}>New {target.singular.toLowerCase()}</Link>
      </div>
      <ResourceTable params={p} searchParams={s} />
    </>
  )
}
