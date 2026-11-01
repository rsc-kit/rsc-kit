import Link from '@rsc-kit/core/Link'
import { resources } from '../../admin/registry'

export default async function AdminHome() {
  const counts = await Promise.all(
    Object.values(resources).map(async (resource) => {
      const { total } = await resource.source.list({ dir: 'asc', page: 1, perPage: 1, filters: {}, searchable: [] })
      return { resource, total }
    }),
  )

  return (
    <>
      <h1>Admin</h1>
      {counts.map(({ resource, total }) => (
        <p key={resource.name}>
          <Link href={`/admin/${resource.name}` as never}>{resource.label}</Link>: {total}
        </p>
      ))}
    </>
  )
}
