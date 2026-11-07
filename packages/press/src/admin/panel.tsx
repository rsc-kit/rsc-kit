import { Suspense } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { notFound } from '@rsc-kit/core/not-found'
import { connection } from '@rsc-kit/core/request'
import { section } from '@rsc-kit/core/section'
import {
  bulkRecords,
  deleteRecord,
  installPlugin,
  reviewPlugin,
  saveRecord,
  secretCopied,
  signOut,
  switchTenant,
  uninstallPlugin,
} from './actions.js'
import { digestOf, fetchManifest, RESERVED, scopeWords } from '../installable.js'
import type { Installs } from '../installable.js'
import type { PanelPlugin } from '../plugin.js'
import { allowOf, contextOf, registerPanel, resourcesFor } from './registry.js'
import type { PanelHandle, Tenancy } from './registry.js'
import { humanize } from '../resource.js'
import type { Column, Field, Option, Resource, SourceContext } from '../resource.js'
import type { AdminTheme, NavItem, PanelUser, PluginsProps, TableRowData } from './theme.js'
import type { ListSearch, PluginsSearch } from './url.js'

import { cursorHref } from './url.js'
import { valuesFor } from '../forms/blueprint.js'
export { listSearch, pluginsSearch, recordParams, resourceParams } from './url.js'

export interface PanelDefinition {
  /** Where the panel's routes are: the folder under src/app it is mounted in. */
  path?: string
  title?: string
  /** The sidebar's mark beside the title, in a panel without tenants. */
  logo?: ComponentType<{ className?: string }>
  resources: Resource[]
  /**
   * What draws the panel: import { shadcn } from '@rsc-kit/press/shadcn', or
   * any object that fulfils AdminTheme. The panel decides what is shown and
   * who may see it; the theme only draws.
   */
  theme: AdminTheme
  /**
   * Whether this request may use the panel. Runs on every page and on every
   * save, delete and switch - an action is reachable without the page that
   * rendered it, so a guard on the pages alone would not be one. A refusal is
   * a 404. The panel has no login of its own: this asks the app's.
   */
  authorize?: () => boolean | Promise<boolean>
  /** Who is signed in, for the sidebar's footer. */
  user?: () => PanelUser | null | Promise<PanelUser | null>
  /** Sign the visitor out. Runs in a server action; the visitor lands on /. */
  signOut?: () => void | Promise<void>
  /** Whose records the panel shows: a switcher in the sidebar, and a tenant on every data source call. */
  tenancy?: Tenancy
  /** Packages that add resources, dashboard widgets and reactions to changes. */
  plugins?: PanelPlugin[]
  /**
   * Plugins a person installs from the panel while it runs, with no rebuild:
   * a manifest url, reviewed, then installed for the current tenant. Mounted
   * as src/app/admin/plugins/page.tsx. See installable.ts for what they can
   * and cannot reach.
   */
  installs?: Installs
  /** The light/dark switch in the header. On unless the app has its own. */
  modeToggle?: boolean
}

/** A type, not an interface: section() takes props that are a record, and an interface has no index signature. */
type Props<P, S = never> = {
  params: Promise<P>
  searchParams: Promise<S>
}

/**
 * A panel: its resources, and the pages that show them, already bound to it.
 * The app mounts each in a route file of its own, because the engine finds
 * routes, url schemas and sections by their files:
 *
 *     src/app/admin/middleware.ts                      export default panel.middleware
 *     src/app/admin/layout.tsx                         export default panel.Layout
 *     src/app/admin/page.tsx                           export default panel.Dashboard
 *     src/app/admin/[resource]/page.tsx                export const params = resourceParams
 *                                                      export const searchParams = listSearch
 *                                                      export default panel.Index
 *     src/app/admin/[resource]/admin-table.section.tsx export default panel.Table
 *     src/app/admin/[resource]/new/page.tsx            export const params = resourceParams
 *                                                      export default panel.Create
 *     src/app/admin/[resource]/[id]/page.tsx           export const params = recordParams
 *                                                      export default panel.Edit
 */
export function definePanel(definition: PanelDefinition) {
  const path = definition.path ?? '/admin'
  const title = definition.title ?? 'Admin'
  const plugins = definition.plugins ?? []
  const resources = [...definition.resources, ...plugins.flatMap((plugin) => plugin.resources ?? [])]
  const authorize = definition.authorize ?? (() => true)
  const tenancy = definition.tenancy ?? null
  const installs = definition.installs ?? null
  const theme = definition.theme
  /** The panel's own resources and its plugins'; any other is one a tenant installed. */
  const own = new Set(resources.map((resource) => resource.name))

  if (!/^(\/[a-z0-9-]+)+$/.test(path)) {
    throw new Error(`[admin] a panel's path is where its routes are, with no trailing slash: ${JSON.stringify(path)}`)
  }

  const names = resources.map((resource) => resource.name)
  const twice = names.find((name, index) => names.indexOf(name) !== index)

  if (twice) throw new Error(`[admin] two resources are named ${twice}; a name is a url segment`)

  const reserved = installs ? names.find((name) => RESERVED.includes(name)) : undefined

  if (reserved) throw new Error(`[admin] a panel that takes installs has a plugins page, so no resource may be named ${reserved}`)

  const pluginNames = plugins.map((plugin) => plugin.name)
  const pluginTwice = pluginNames.find((name, index) => pluginNames.indexOf(name) !== index)

  if (pluginTwice) throw new Error(`[admin] the plugin ${pluginTwice} is installed twice`)

  // A relation names a resource by its url segment. Checked here, once every
  // resource is known, so a misspelt one fails at startup and not on the
  // first form that needs its choices.
  for (const resource of resources) {
    const named = [...resource.relations, ...resource.columns.map((column) => column.relation)]

    for (const relation of named) {
      if (relation !== undefined && !names.includes(relation)) {
        throw new Error(`[admin] ${resource.name} relates to ${relation}, which is not a resource of this panel`)
      }
    }
  }

  const handle: PanelHandle = { path, resources, authorize, plugins, tenancy, signOut: definition.signOut ?? null, installs }

  registerPanel(handle)

  /** A url of the panel. Typed routes are the app's; the panel's are its own. */
  const to = (...parts: string[]) => [path, ...parts].join('/')

  /**
   * A related resource's rows as choices: its key saved, its title shown.
   * Every row, scoped to the visitor's tenant like any list - so a belongsTo
   * is for a resource with a select's worth of rows: categories, teams,
   * plans. Memoised per render, so a field and a column naming the same
   * resource list it once.
   */
  function choices(context: SourceContext, resources: Resource[]) {
    const listed = new Map<string, Promise<Option[]>>()

    return (name: string): Promise<Option[]> => {
      let found = listed.get(name)

      if (!found) {
        const related = resources.find((resource) => resource.name === name)!

        found = related.source
          .list({ dir: 'asc', page: 1, perPage: null, filters: {}, searchable: [] }, context)
          .then(({ rows }) => rows.map((row) => ({ value: String(row[related.key]), label: String(row[related.title]) })))
        listed.set(name, found)
      }

      return found
    }
  }

  /** The form's fields, each relation given its choices: the create form's, or the edit form's. */
  async function fieldsFor(resource: Resource, context: SourceContext, editing = false): Promise<Field[]> {
    const of = choices(context, await resourcesFor(handle, context))

    return Promise.all((editing ? resource.editFields : resource.fields).map(async (field) => (field.relation ? { ...field, options: await of(field.relation) } : field)))
  }

  /**
   * The panel's door: a refusal is a 404, so the panel's existence is not
   * shown. Per request, always - authorize is about this visitor and the rows
   * are live - so the build stores the skeleton and never runs either.
   */
  async function enter(): Promise<SourceContext>
  async function enter(name: string): Promise<{ resource: Resource; context: SourceContext }>
  async function enter(name?: string) {
    await connection()

    if (!(await authorize())) notFound()

    const context = (await contextOf(handle)) ?? notFound()

    if (name === undefined) return context

    return { resource: (await resourcesFor(handle, context)).find((resource) => resource.name === name) ?? notFound(), context }
  }

  /**
   * The panel's guard, mounted as src/app/admin/middleware.ts. It runs before
   * anything is sent, so its refusals are real 404s: a visitor authorize turns
   * away, no tenant or another's, a resource the panel does not have, a record
   * that is not there - or not this tenant's. The pages check again, inside
   * their boundaries, where a refusal can no longer change the status.
   */
  async function middleware(params: Record<string, string | undefined> = {}) {
    if (!(await authorize())) notFound()

    const context = (await contextOf(handle)) ?? notFound()

    if (params.resource === undefined) return

    const resource = (await resourcesFor(handle, context)).find((candidate) => candidate.name === params.resource) ?? notFound()

    // An edit page changes a record. A read-only resource's new page cannot
    // be told apart here - it has the list's params - so it refuses itself.
    if (resource.readOnly && params.id !== undefined) notFound()

    if (params.id !== undefined && !(await resource.source.find(params.id, context))) notFound()
  }

    /** The sidebar's header: the tenant switcher, or the panel's name. */
  async function Tenants() {
    await connection()

    const context = (await authorize()) && tenancy ? await contextOf(handle) : null

    if (!tenancy || !context?.tenant) return brand()

    return (
      <theme.TenantSwitcher
        tenants={await tenancy.tenants()}
        current={context.tenant}
        label={tenancy.label ?? 'Teams'}
        choose={switchTenant.bind(null, path)}
      />
    )
  }

  function brand() {
    const Logo = definition.logo

    return <theme.Brand href={path} title={title} {...(Logo ? { logo: <Logo /> } : {})} />
  }

  async function User() {
    await connection()

    const user = (await authorize()) ? await definition.user?.() : null

    if (!user) return null

    return <theme.UserMenu user={user} {...(definition.signOut ? { signOut: signOut.bind(null, path) } : {})} />
  }

  /** A resource's own icon, drawn; the theme draws a default for one without. */
  function iconOf(resource: Resource) {
    const Icon = resource.icon

    return Icon ? { icon: <Icon /> } : {}
  }

  /** The sidebar's links: the panel's resources, then the tenant's installed ones, then Plugins. */
  function navOf(shown: Resource[]): NavItem[] {
    return [
      { href: path, label: 'Dashboard', kind: 'dashboard', exact: true },
      ...shown.map((resource): NavItem => ({
        href: to(resource.name),
        label: resource.label,
        kind: own.has(resource.name) ? 'resource' : 'installed',
        ...iconOf(resource),
      })),
      ...(installs ? [{ href: to('plugins'), label: 'Plugins', kind: 'plugins' } as const] : []),
    ]
  }

  /** Installed resources are this tenant's and this request's, so the nav waits for them; the panel's own show meanwhile. */
  async function InstalledNav() {
    await connection()

    const context = (await authorize()) ? await contextOf(handle) : null

    return <theme.Nav items={navOf(context ? await resourcesFor(handle, context) : resources)} />
  }

  function crumbsOf(shown: Resource[]) {
    return (
      <theme.Breadcrumbs
        root={path}
        title={title}
        labels={{ ...(installs ? { plugins: 'Plugins' } : {}), ...Object.fromEntries(shown.map((resource) => [resource.name, resource.label])) }}
      />
    )
  }

  async function InstalledCrumbs() {
    await connection()

    const context = (await authorize()) ? await contextOf(handle) : null

    return crumbsOf(context ? await resourcesFor(handle, context) : resources)
  }

  function Layout({ children }: { children: ReactNode }) {
    return (
      <theme.Shell
        title={title}
        modeToggle={definition.modeToggle !== false}
        brand={
          tenancy ? (
            <Suspense fallback={<theme.Loading kind="menu" />}>
              <Tenants />
            </Suspense>
          ) : (
            brand()
          )
        }
        nav={
          installs ? (
            <Suspense fallback={<theme.Nav items={navOf(resources)} />}>
              <InstalledNav />
            </Suspense>
          ) : (
            <theme.Nav items={navOf(resources)} />
          )
        }
        user={
          definition.user ? (
            <Suspense fallback={<theme.Loading kind="menu" />}>
              <User />
            </Suspense>
          ) : null
        }
        crumbs={
          installs ? (
            <Suspense fallback={crumbsOf(resources)}>
              <InstalledCrumbs />
            </Suspense>
          ) : (
            crumbsOf(resources)
          )
        }
      >
        {children}
      </theme.Shell>
    )
  }

  async function DashboardBody() {
    const context = await enter()
    const counts = await Promise.all(
      (await resourcesFor(handle, context)).map(async (resource) => {
        // An installed plugin is somebody else's server: one that is down
        // leaves its card blank, not the dashboard broken.
        const total = await resource.source
          .list({ dir: 'asc', page: 1, perPage: 1, filters: {}, searchable: [] }, context)
          .then(({ total: counted }) => counted as number | null)
          .catch((error: unknown) => {
            console.error(`[admin] counting ${resource.name} failed`, error)

            return null
          })

        return { name: resource.name, label: resource.label, href: to(resource.name), total, ...iconOf(resource) }
      }),
    )

    return (
      <theme.Dashboard
        description={context.tenant ? `Everything in ${context.tenant.name}.` : 'Everything in the panel, at a glance.'}
        counts={counts}
        widgets={plugins.flatMap((plugin) =>
          (plugin.widgets ?? []).map(({ title: widgetTitle, description, component: Widget }, index) => ({
            key: `${plugin.name}:${index}`,
            title: widgetTitle,
            ...(description ? { description } : {}),
            content: <Widget tenant={context.tenant} />,
          })),
        )}
      />
    )
  }

  /**
   * The table, as a section: a delete refreshes it and nothing else. A
   * refresh renders it with the page's params and searchParams, and nothing
   * else - which is why it is bound to the panel here rather than handed one
   * as a prop.
   */
  async function TableBody({ params, searchParams }: Props<{ resource: string }, ListSearch>) {
    const { resource, context } = await enter((await params).resource)
    const search = await searchParams
    const { q, sort, dir, page, cursor, ...rest } = search
    const filters: Record<string, string> = Object.fromEntries(
      Object.entries(rest).flatMap(([key, value]) =>
        typeof value === 'string' && value !== '' && resource.filters.some((filter) => filter.key === key) ? [[key, value]] : [],
      ),
    )
    const sortable = resource.columns.some((column) => column.sortable && column.key === sort) ? sort : undefined
    const server = resource.mode === 'server'
    const searchable = resource.columns.filter((column) => column.searchable).map((column) => column.key)
    const listed = await resource.source.list(
      server
        ? {
            ...(q ? { q } : {}),
            ...(sortable ? { sort: sortable } : {}),
            dir,
            page,
            ...(cursor ? { cursor } : {}),
            perPage: resource.perPage,
            filters,
            searchable,
          }
        : { dir: 'asc', page: 1, perPage: null, filters: {}, searchable },
      context,
    )
    const { rows } = listed
    const total = typeof listed.total === 'number' ? listed.total : null
    // A page of a list paged by cursor: the pager asks for the cursor it was
    // handed, with the search, filters and sort the visitor is on.
    const cursorUrl = (at: string | null | undefined) =>
      at ? cursorHref(to(resource.name), { ...(q ? { q } : {}), ...(sortable ? { sort: sortable } : {}), dir, filters }, at) : null
    const cursors = server && 'next' in listed ? { prev: cursorUrl(listed.prev), next: cursorUrl(listed.next) } : undefined

    // A relation column shows the related row's title, and is searched and
    // sorted by it in the browser too: what the visitor reads is what they type.
    const of = choices(context, await resourcesFor(handle, context))
    const titles = new Map(
      await Promise.all(
        resource.columns
          .filter((column) => column.relation !== undefined)
          .map(async (column) => [column.key, new Map((await of(column.relation!)).map((option) => [option.value, option.label]))] as const),
      ),
    )
    const shown = (column: Column, value: unknown) => {
      const title = value === null || value === undefined ? undefined : titles.get(column.key)?.get(String(value))

      return title ?? value
    }

    const drawn: TableRowData[] = await Promise.all(
      rows.map(async (row) => {
        const id = String(row[resource.key])

        return {
          id,
          cells: Object.fromEntries(
            await Promise.all(resource.columns.map(async (column) => [column.key, await draw(theme, column, shown(column, row[column.key]), row)] as const)),
          ),
          values: Object.fromEntries(resource.columns.map((column) => [column.key, plain(shown(column, row[column.key]))])),
          ...(resource.readOnly
            ? {}
            : { edit: to(resource.name, encodeURIComponent(id)), remove: deleteRecord.bind(null, path, resource.name, id) }),
        }
      }),
    )

    return (
      <theme.Table
        mode={resource.mode}
        href={to(resource.name)}
        columns={resource.columns.map(({ key, label, sortable: canSort, searchable: canSearch, visible }) => ({
          key,
          label,
          sortable: canSort,
          searchable: canSearch,
          visible,
        }))}
        rows={drawn}
        total={total}
        {...(cursors ? { cursors } : {})}
        perPage={resource.perPage}
        query={{ q: q ?? '', ...(sortable ? { sort: sortable } : {}), dir, page, filters }}
        filters={resource.filters}
        noun={{ one: resource.singular, many: resource.label }}
        {...(resource.readOnly
          ? {}
          : {
              bulk: {
                actions: [
                  ...resource.bulkActions.map(({ name, label, destructive }) => ({ name, label, destructive: destructive ?? false })),
                  { name: 'delete', label: 'Delete', destructive: true },
                ],
                run: bulkRecords.bind(null, path, resource.name),
              },
            })}
      />
    )
  }

  const Table = section('admin-table', TableBody)

  async function IndexBody({ params, searchParams }: Props<{ resource: string }, ListSearch>) {
    const { resource } = await enter((await params).resource)

    return (
      <theme.Index
        title={resource.label}
        {...(resource.description ? { description: resource.description } : {})}
        {...(resource.readOnly ? {} : { create: { href: to(resource.name, 'new'), label: `New ${resource.singular.toLowerCase()}` } })}
        table={<Table params={params} searchParams={searchParams} />}
      />
    )
  }

  async function CreateBody({ params }: Props<{ resource: string }>) {
    const { resource, context } = await enter((await params).resource)

    if (resource.readOnly) notFound()

    return (
      <theme.Form
        title={`New ${resource.singular.toLowerCase()}`}
        description={`Add a ${resource.singular.toLowerCase()} to ${resource.label.toLowerCase()}.`}
        action={saveRecord.bind(null, path, resource.name, null)}
        fields={await fieldsFor(resource, context)}
        values={{}}
        submit={`Create ${resource.singular.toLowerCase()}`}
        cancel={to(resource.name)}
      />
    )
  }

  async function EditBody({ params }: Props<{ resource: string; id: string }>) {
    const { resource: name, id } = await params
    const { resource, context } = await enter(name)
    const record = resource.readOnly ? null : await resource.source.find(id, context)

    if (!record) notFound()

    // Only the form's fields reach the browser, not every column the record has.
    const editFields = await fieldsFor(resource, context, true)

    return (
      <theme.Form
        title={String(record[resource.title])}
        description={`Edit this ${resource.singular.toLowerCase()}.`}
        action={saveRecord.bind(null, path, resource.name, id)}
        fields={editFields}
        values={valuesFor(editFields, record)}
        submit="Save changes"
        cancel={to(resource.name)}
      />
    )
  }

  /** The installed plugins, a manifest under review, and the form to start one. */
  async function PluginsBody({ searchParams }: { searchParams: Promise<PluginsSearch> }) {
    const context = await enter()

    if (!installs) notFound()

    const allowed = !installs.manage || (await installs.manage())
    const { review } = await searchParams
    const installed = await installs.store.list(context.tenant)
    const labelOf = (name: string) => resources.find((resource) => resource.name === name)?.label ?? name
    let reviewing: PluginsProps['reviewing'] = null

    // Once installed, the review is over: the install re-renders this url in place, ?review= and all.
    if (review && allowed && !installed.some((installation) => installation.manifestUrl === review)) {
      try {
        const manifest = await fetchManifest(review, allowOf(handle), resources.map((resource) => resource.name))

        reviewing = {
          label: manifest.label,
          ...(manifest.version ? { version: manifest.version } : {}),
          description: manifest.description ?? new URL(manifest.endpoint).host,
          adds: manifest.resources.map((resource) => resource.label ?? humanize(resource.name)),
          can: manifest.scopes.length === 0 ? [] : scopeWords(manifest, labelOf),
          endpoint: manifest.endpoint,
          install: installPlugin.bind(null, path, review, await digestOf(manifest)),
          cancel: to('plugins'),
        }
      } catch (error) {
        reviewing = { problem: error instanceof Error ? error.message : 'The manifest could not be read.' }
      }
    }

    return (
      <theme.Plugins
        description={`Installed for ${context.tenant ? context.tenant.name : 'this panel'}. A plugin runs on its own server; it sees what you grant it here and nothing else.`}
        allowed={allowed}
        review={reviewPlugin.bind(null, path)}
        reviewing={reviewing}
        installed={installed.map((installation) => ({
          id: installation.id,
          label: installation.manifest.label,
          description: installation.manifest.description ?? new URL(installation.manifest.endpoint).host,
          resources: installation.manifest.resources.map((resource) => resource.label ?? humanize(resource.name)),
          scopes: installation.manifest.scopes,
          ...(allowed ? { uninstall: uninstallPlugin.bind(null, path, installation.id) } : {}),
          ...(allowed && !installation.secretSeen
            ? { secret: { installation: installation.id, secret: installation.secret, copied: secretCopied.bind(null, path, installation.id) } }
            : {}),
        }))}
      />
    )
  }

  // The pages read their url above everything they show, so each waits inside
  // a boundary of its own: the build stores the theme's Loading as the page's
  // shell, and a page that awaited params above every boundary would fail it.
  // A panel cannot put a loading.tsx beside the app's route files; this is that.
  function Dashboard() {
    return (
      <Suspense fallback={<theme.Loading kind="dashboard" />}>
        <DashboardBody />
      </Suspense>
    )
  }

  function Index(props: Props<{ resource: string }, ListSearch>) {
    return (
      <Suspense fallback={<theme.Loading kind="table" />}>
        <IndexBody {...props} />
      </Suspense>
    )
  }

  function Create(props: Props<{ resource: string }>) {
    return (
      <Suspense fallback={<theme.Loading kind="form" />}>
        <CreateBody {...props} />
      </Suspense>
    )
  }

  function Edit(props: Props<{ resource: string; id: string }>) {
    return (
      <Suspense fallback={<theme.Loading kind="form" />}>
        <EditBody {...props} />
      </Suspense>
    )
  }

  function Plugins(props: { searchParams: Promise<PluginsSearch> }) {
    return (
      <Suspense fallback={<theme.Loading kind="form" />}>
        <PluginsBody {...props} />
      </Suspense>
    )
  }

  return { path, resources, middleware, Layout, Dashboard, Index, Table, Create, Edit, Plugins }
}

export type Panel = ReturnType<typeof definePanel>

/** A cell: the column's own cell(), the theme's drawing of its format, or the value as text. */
async function draw(theme: AdminTheme, column: Column, value: unknown, row: unknown): Promise<ReactNode> {
  if (column.cell) return column.cell(value, row)
  if (column.format === 'text' || column.format === 'relation') return String(value ?? '')

  return <theme.Cell format={column.format} value={value} />
}

/** A value the browser can sort and search by. */
function plain(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value

  return String(value)
}
