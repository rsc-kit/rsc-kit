'use server'

import { fieldErrors } from '@rsc-kit/core/action'
import { redirect } from '@rsc-kit/core/redirect'
import { revalidate } from '@rsc-kit/core/revalidate'
import { resource, valuesFrom } from './kit-server'

/**
 * One save for every resource, bound to it by the page:
 * saveRecord.bind(null, 'products', id). The resource's own schema is the
 * check, so a field the form left out is refused here as it would be there.
 */
export async function saveRecord(name: string, id: string | null, form: FormData) {
  const target = resource(name)

  if (!target) throw new Error(`No resource ${name}`)

  const parsed = target.schema.safeParse(valuesFrom(target, form))

  if (!parsed.success) {
    const errors = Object.fromEntries(
      Object.entries(parsed.error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => !!entry[1]?.length),
    )

    return fieldErrors(errors)
  }

  if (id) await target.source.update(id, parsed.data)
  else await target.source.create(parsed.data)

  redirect(`/admin/${name}` as never)
}

/** Deleting from the table refreshes the table, and nothing else on the page. */
export async function deleteRecord(name: string, id: string) {
  await resource(name)?.source.delete(id)
  revalidate('admin-table')
}
