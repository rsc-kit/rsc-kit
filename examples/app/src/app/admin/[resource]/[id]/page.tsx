import * as z from 'zod'
import { notFound } from '@rsc-kit/core/not-found'
import type { PageProps } from '@rsc-kit/core/route-schema'
import { saveRecord } from '../../../../admin/actions'
import { resource } from '../../../../admin/registry'
import { ResourceForm } from '../../../../admin/ui/ResourceForm'

export const params = z.object({ resource: z.string(), id: z.string() })

export default async function EditRecord({ params: p }: PageProps<typeof params>) {
  const { resource: name, id } = await p
  const target = resource(name)
  const record = await target?.source.find(id)

  if (!target || !record) notFound()

  return (
    <>
      <h1>
        Edit {target.singular.toLowerCase()}: {String(record[target.title])}
      </h1>
      <ResourceForm action={saveRecord.bind(null, name, id)} fields={target.fields} values={record} submit="Save" />
    </>
  )
}
