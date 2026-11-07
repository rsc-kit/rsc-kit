'use server'

import { fieldErrors } from '@rsc-kit/core/action'
import { flash } from '@rsc-kit/core/flash'
import { redirect } from '@rsc-kit/core/redirect'
import { revalidate } from '@rsc-kit/core/revalidate'
import { digestOf, fetchManifest, newInstallation } from '../installable.js'
import { allowOf, allowedResource, contextOf, panelAt, resourcesFor, tellAll } from './registry.js'
import { bulkToast, parse } from '../resource.js'

/**
 * One save for every resource, bound by the page:
 * saveRecord.bind(null, '/admin', 'products', id). The resource's own schema
 * is the check, and the panel's authorize runs first, on every call - an
 * action is reachable without the page that rendered it.
 */
export async function saveRecord(path: string, name: string, id: string | null, form: FormData) {
  const { resource, context } = await allowedResource(path, name)
  const current = id === null ? null : await resource.source.find(id, context)

  if (id !== null && !current) throw new Error(`[admin] no ${name} ${id} here`)

  // What the record had is what a file field may keep without uploading again.
  // A backend's create and update may take different fields: a password
  // required to create is optional to edit.
  const target = id === null ? resource : { schema: resource.editSchema, fields: resource.editFields }
  const parsed = await parse(target, form, { current: current as Record<string, unknown> | null, tenant: context.tenant })

  if (!parsed.ok) return fieldErrors(parsed.errors)

  // A relation's value is an id the browser sent, so it is looked up as the
  // visitor: one from another tenant, or none at all, is not one of theirs.
  const values = parsed.values as Record<string, unknown>
  const unrelated: Record<string, string> = {}

  for (const field of target.fields) {
    const value = values[field.name]

    if (!field.relation || value === undefined || value === null || value === '') continue

    const related = (await resourcesFor(panelAt(path), context)).find((candidate) => candidate.name === field.relation)!

    if (!(await related.source.find(String(value), context))) unrelated[field.name] = `Choose one of the listed ${related.label.toLowerCase()}.`
  }

  if (Object.keys(unrelated).length > 0) return fieldErrors(unrelated)

  const row = id === null ? await resource.source.create(parsed.values, context) : await resource.source.update(id, parsed.values, context)

  await tellAll(
    panelAt(path),
    { panel: path, resource: name, id: id ?? String(row[resource.key] ?? ''), change: id === null ? 'created' : 'updated', values: parsed.values, tenant: context.tenant },
    context,
  )

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
  await tellAll(panelAt(path), { panel: path, resource: name, id, change: 'deleted', tenant: context.tenant }, context)
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
      await tellAll(panelAt(path), { panel: path, resource: name, id, change: 'deleted', tenant: context.tenant }, context)
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

/** The panel, once this visitor may install and uninstall there. */
async function managed(path: string) {
  const panel = panelAt(path)

  if (!panel.installs || !(await panel.authorize())) throw new Error('[admin] not allowed')
  if (panel.installs.manage && !(await panel.installs.manage())) throw new Error('[admin] not allowed to manage plugins')

  const context = await contextOf(panel)

  if (!context) throw new Error('[admin] no tenant chosen, or not one of this visitor\'s')

  return { panel, installs: panel.installs, context }
}

/** A manifest url, fetched and checked, then shown for review. Nothing is installed yet. */
export async function reviewPlugin(path: string, form: FormData) {
  const { panel } = await managed(path)
  const url = String(form.get('manifest') ?? '').trim()

  try {
    await fetchManifest(url, allowOf(panel), panel.resources.map((resource) => resource.name))
  } catch (error) {
    return fieldErrors({ manifest: error instanceof Error ? error.message : 'The manifest could not be read.' })
  }

  redirect(`${path}/plugins?review=${encodeURIComponent(url)}` as never)
}

/**
 * Install what was reviewed. The manifest is fetched again and must match the
 * digest the review page showed: a plugin that changed its scopes between the
 * review and the click is refused, not installed with scopes nobody read.
 */
export async function installPlugin(path: string, url: string, digest: string) {
  const { panel, installs, context } = await managed(path)
  const host = panel.resources.map((resource) => resource.name)
  const manifest = await fetchManifest(url, allowOf(panel), host)

  if ((await digestOf(manifest)) !== digest) {
    await flash('The plugin changed since you reviewed it. Review it again.', 'error')
    redirect(`${path}/plugins?review=${encodeURIComponent(url)}` as never)
  }

  const installed = await installs.store.list(context.tenant)
  const taken = new Set([...host, ...installed.flatMap((installation) => installation.manifest.resources.map((resource) => resource.name))])

  if (installed.some((installation) => installation.manifest.name === manifest.name)) {
    await flash(`${manifest.label} is already installed.`, 'error')
    redirect(`${path}/plugins` as never)
  }

  const clash = manifest.resources.find((resource) => taken.has(resource.name))

  if (clash) {
    await flash(`Another plugin already adds ${clash.name}.`, 'error')
    redirect(`${path}/plugins` as never)
  }

  await installs.store.add(context.tenant, newInstallation(url, manifest))
  await flash(`${manifest.label} installed. Copy its secret into the plugin.`)
  // Re-rendered in place, not redirected: its resources join the sidebar,
  // which is in a layout a redirect keeps mounted from before the install.
  // The review it came from closes itself once the manifest is installed.
  revalidate('all' as never)
}

/** Uninstalled: its secret goes with it, so every call it could have answered stops at once. */
export async function uninstallPlugin(path: string, id: string) {
  const { installs, context } = await managed(path)
  const installation = (await installs.store.list(context.tenant)).find((candidate) => candidate.id === id)

  if (!installation) return

  await installs.store.remove(context.tenant, id)
  await flash(`${installation.manifest.label} uninstalled.`)
  revalidate('all' as never)
}

/** The secret was copied into the plugin; the plugins page stops showing it. */
export async function secretCopied(path: string, id: string) {
  const { installs, context } = await managed(path)

  await installs.store.seen(context.tenant, id)
  redirect(`${path}/plugins` as never)
}
