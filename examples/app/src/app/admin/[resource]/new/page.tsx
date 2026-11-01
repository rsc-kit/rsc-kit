import * as z from 'zod'
import { notFound } from '@rsc-kit/core/not-found'
import type { PageProps } from '@rsc-kit/core/route-schema'
import { saveRecord } from '../../../../admin/actions'
import { resource } from '../../../../admin/registry'
import { ResourceForm } from '../../../../admin/ui/ResourceForm'

export const params = z.object({ resource: z.string() })

export default async function NewRecord({ params: p }: PageProps<typeof params>) {
  const { resource: name } = await p
  const target = resource(name)

  if (!target) notFound()

  return (
    <>
      <h1>New {target.singular.toLowerCase()}</h1>
      <ResourceForm action={saveRecord.bind(null, name, null)} fields={target.fields} values={{}} submit="Create" />
    </>
  )
}
