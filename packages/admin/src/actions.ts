'use server'

import { fieldErrors } from '@rsc-kit/core/action'
import { flash } from '@rsc-kit/core/flash'
import { redirect } from '@rsc-kit/core/redirect'
import { revalidate } from '@rsc-kit/core/revalidate'
import { tell } from './plugin.js'
import { allowedResource, panelAt } from './registry.js'
import { bulkToast, parse } from './resource.js'

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

  // A relation's value is an id the browser sent, so it is looked up as the
  // visitor: one from another tenant, or none at all, is not one of theirs.
  const values = parsed.values as Record<string, unknown>
  const unrelated: Record<string, string> = {}

  for (const field of resource.fields) {
    const value = values[field.name]

    if (!field.relation || value === undefined || value === null || value === '') continue

    const related = panelAt(path).resources.find((candidate) => candidate.name === field.relation)!

    if (!(await related.source.find(String(value), context))) unrelated[field.name] = `Choose one of the listed ${related.label.toLowerCase()}.`
  }

  if (Object.keys(unrelated).length > 0) return fieldErrors(unrelated)

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

/**
 * The rows ticked in the table, deleted or handed to one of the resource's
 * bulk actions. Each id is found as the visitor first, so one from another
 * tenant, or already gone, is left out rather than acted on.
 */
export async function bulkRecords(path: string, name: string, action: string, ids: string[]) {
  const { resource, context } = await allowedResource(path, name)
  const bulk = action === 'delete' ? null : resource.bulkActions.find((candidate) => candidate.name === action)

  if (bulk === undefined) throw new Error(`[admin] ${name} has no bulk action ${action}`)

  const found = await Promise.all([...new Set(ids.map(String))].map(async (id) => [id, await resource.source.find(id, context)] as const))
  const rows = found.filter(([, row]) => row !== null && row !== undefined)
  const noun = (count: number) => (count === 1 ? resource.singular : resource.label).toLowerCase()

  if (bulk === null) {
    for (const [id] of rows) {
      await resource.source.delete(id, context)
      await tell(panelAt(path).plugins, { panel: path, resource: name, id, change: 'deleted', tenant: context.tenant })
    }

    await flash(bulkToast({ label: 'Delete', done: 'deleted' }, rows.length, noun(rows.length)))
  } else {
    const said = await bulk.run(rows.map(([, row]) => row), context)

    await flash(typeof said === 'string' ? said : bulkToast(bulk, rows.length, noun(rows.length)))
  }

  revalidate('admin-table' as never)
}

/** The switcher's choice, checked against the visitor's own tenants, then the dashboard. */
export async function switchTenant(path: string, id: string) {
  const panel = panelAt(path)

  if (!(await panel.authorize()) || !panel.tenancy) throw new Error('[admin] not allowed')

  const theirs = await panel.tenancy.tenants()

  if (!theirs.some((tenant) => tenant.id === id)) throw new Error('[admin] not one of this visitor\'s tenants')

  await panel.tenancy.switch(id)
  // The team's name and nav are in the layout, which a redirect keeps as it
  // was unless the action says what it changed.
  revalidate('all' as never)
  redirect(path as never)
}

export async function signOut(path: string) {
  const panel = panelAt(path)

  await panel.signOut?.()
  redirect('/' as never)
}
