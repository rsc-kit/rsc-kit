'use server'

import { fieldErrors } from '@rsc-kit/core/action'
import { flash } from '@rsc-kit/core/flash'
import { redirect } from '@rsc-kit/core/redirect'
import { revalidate } from '@rsc-kit/core/revalidate'
import { tell } from './plugin.js'
import { allowedResource, panelAt } from './registry.js'
import { parse } from './resource.js'

/**
 * One save for every resource, bound by the page:
 * saveRecord.bind(null, '/admin', 'products', id). The resource's own schema
 * is the check, and the panel's authorize runs first, on every call - an
 * action is reachable without the page that rendered it.
 */
export async function saveRecord(path: string, name: string, id: string | null, form: FormData) {
  const { resource, context } = await allowedResource(path, name)
  const parsed = await parse(resource, form)

  if (!parsed.ok) return fieldErrors(parsed.errors)

  if (id !== null && !(await resource.source.find(id, context))) throw new Error(`[admin] no ${name} ${id} here`)

  const row = id === null ? await resource.source.create(parsed.values, context) : await resource.source.update(id, parsed.values, context)

  await tell(panelAt(path).plugins, {
    panel: path,
    resource: name,
    id: String(row[resource.key]),
    change: id === null ? 'created' : 'updated',
    values: parsed.values,
    tenant: context.tenant,
  })

  // The form is replaced by the list the redirect lands on, so the word
  // that it worked rides along to that page.
  await flash(`${resource.singular} ${id === null ? 'created' : 'saved'}.`)

  redirect(`${path}/${name}` as never)
}

/** Deleting from the table refreshes the table, and nothing else on the page. */
export async function deleteRecord(path: string, name: string, id: string) {
  const { resource, context } = await allowedResource(path, name)

  if (!(await resource.source.find(id, context))) return

  await resource.source.delete(id, context)
  await tell(panelAt(path).plugins, { panel: path, resource: name, id, change: 'deleted', tenant: context.tenant })
  await flash(`${resource.singular} deleted.`)
  revalidate('admin-table' as never)
}

/** The switcher's choice, checked against the visitor's own tenants, then the dashboard. */
export async function switchTenant(path: string, id: string) {
  const panel = panelAt(path)

  if (!(await panel.authorize()) || !panel.tenancy) throw new Error('[admin] not allowed')

  const theirs = await panel.tenancy.tenants()

  if (!theirs.some((tenant) => tenant.id === id)) throw new Error('[admin] not one of this visitor\'s tenants')

  await panel.tenancy.switch(id)
  redirect(path as never)
}

export async function signOut(path: string) {
  const panel = panelAt(path)

  await panel.signOut?.()
  redirect('/' as never)
}
