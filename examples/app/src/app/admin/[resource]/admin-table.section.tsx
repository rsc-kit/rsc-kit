import Link from '@rsc-kit/core/Link'
import { section } from '@rsc-kit/core/section'
import { deleteRecord } from '../../../admin/actions'
import type { Column } from '../../../admin/kit'
import { resource } from '../../../admin/registry'
import { DeleteButton } from '../../../admin/ui/DeleteButton'
import type { listSearch } from './query'
import type * as z from 'zod'

type Search = z.infer<typeof listSearch>

/**
 * The table, as a section: a delete refreshes it and leaves the search box and
 * filters above it as they were.
 */
async function ResourceTableBody({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<Search> }) {
  const { resource: name } = await params
  const search = await searchParams
  const target = resource(name)!
  const { q, sort, dir, page, ...filters } = search
  const { rows, total } = await target.source.list({
    q,
    sort: target.columns.some((column) => column.sortable && column.key === sort) ? sort : undefined,
    dir,
    page,
    perPage: target.perPage,
    filters: Object.fromEntries(Object.entries(filters).filter(([key]) => target.filters.some((filter) => filter.key === key))),
    searchable: target.columns.filter((column) => column.searchable).map((column) => column.key),
  })
  const pages = Math.max(1, Math.ceil(total / target.perPage))
  const at = (changes: Record<string, string | number>) => ({ ...search, ...changes }) as never

  return (
    <>
      <table>
        <thead>
          <tr>
            {target.columns.map((column) => (
              <th key={column.key}>
                {column.sortable ? (
                  <Link href={`/admin/${name}` as never} search={at({ sort: column.key, dir: sort === column.key && dir === 'asc' ? 'desc' : 'asc', page: 1 })}>
                    {column.label}
                    {sort === column.key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </Link>
                ) : column.label}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = String(row[target.key])

            return (
              <tr key={id}>
                {target.columns.map((column) => <td key={column.key}>{cell(column, row[column.key])}</td>)}
                <td>
                  <Link href={`/admin/${name}/${id}` as never}>Edit</Link>{' '}
                  <DeleteButton action={deleteRecord.bind(null, name, id)} />
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={target.columns.length + 1}>Nothing matches.</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="admin-pages">
        {page > 1 && <Link href={`/admin/${name}` as never} search={at({ page: page - 1 })}>Previous</Link>}
        <span>
          Page {page} of {pages} · {total} {target.label.toLowerCase()}
        </span>
        {page < pages && <Link href={`/admin/${name}` as never} search={at({ page: page + 1 })}>Next</Link>}
      </div>
    </>
  )
}

function cell(column: Column, value: unknown) {
  switch (column.format) {
    case 'money':
      return `$${Number(value).toFixed(2)}`
    case 'badge':
      return <span className="admin-badge">{String(value)}</span>
    case 'boolean':
      return value ? '✓' : ''
    default:
      return String(value ?? '')
  }
}

const ResourceTable = section('admin-table', ResourceTableBody)

export default ResourceTable
