import { Suspense } from 'react'
import type { ComponentType, ReactNode } from 'react'
import Link from '@rsc-kit/core/Link'
import { notFound } from '@rsc-kit/core/not-found'
import { connection } from '@rsc-kit/core/request'
import { section } from '@rsc-kit/core/section'
import { LayoutDashboard, Plus, Table2 } from 'lucide-react'
import { deleteRecord, saveRecord, signOut, switchTenant } from './actions'
import type { PanelPlugin } from './plugin'
import { contextOf, registerPanel } from './registry'
import type { PanelHandle, Tenancy } from './registry'
import type { Column, Resource, SourceContext } from './resource'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Separator } from './components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from './components/ui/sidebar'
import { Skeleton } from './components/ui/skeleton'
import { TooltipProvider } from './components/ui/tooltip'
import { PanelBreadcrumbs } from './ui/breadcrumbs'
import { DataTable } from './ui/data-table'
import type { TableRowData } from './ui/data-table'
import { ModeToggle } from './ui/mode-toggle'
import { themeScript } from './ui/theme-script'
import { PanelNav } from './ui/nav'
import { ResourceForm } from './ui/resource-form'
import { TenantSwitcher } from './ui/tenant-switcher'
import { UserMenu } from './ui/user-menu'
import type { PanelUser } from './ui/user-menu'

import type { ListSearch } from './url'

export { listSearch, recordParams, resourceParams } from './url'

export interface PanelDefinition {
  /** Where the panel's routes are: the folder under src/app it is mounted in. */
  path?: string
  title?: string
  /** The sidebar's mark beside the title, in a panel without tenants. */
  logo?: ComponentType<{ className?: string }>
  resources: Resource[]
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

  if (!/^(\/[a-z0-9-]+)+$/.test(path)) {
    throw new Error(`[admin] a panel's path is where its routes are, with no trailing slash: ${JSON.stringify(path)}`)
  }

  const names = resources.map((resource) => resource.name)
  const twice = names.find((name, index) => names.indexOf(name) !== index)

  if (twice) throw new Error(`[admin] two resources are named ${twice}; a name is a url segment`)

  const pluginNames = plugins.map((plugin) => plugin.name)
  const pluginTwice = pluginNames.find((name, index) => pluginNames.indexOf(name) !== index)

  if (pluginTwice) throw new Error(`[admin] the plugin ${pluginTwice} is installed twice`)

  const handle: PanelHandle = { path, resources, authorize, plugins, tenancy, signOut: definition.signOut ?? null }

  registerPanel(handle)

  /** A url of the panel. Typed routes are the app's; the panel's are its own. */
  const to = (...parts: string[]) => [path, ...parts].join('/')

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

    return { resource: resources.find((resource) => resource.name === name) ?? notFound(), context }
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

    const resource = resources.find((candidate) => candidate.name === params.resource) ?? notFound()

    // An edit page changes a record. A read-only resource's new page cannot
    // be told apart here - it has the list's params - so it refuses itself.
    if (resource.readOnly && params.id !== undefined) notFound()

    if (params.id !== undefined && !(await resource.source.find(params.id, context))) notFound()
  }

  /** The sidebar's header: the tenant switcher, or the panel's name. */
  async function Tenants() {
    await connection()

    const context = (await authorize()) && tenancy ? await contextOf(handle) : null

    if (!tenancy || !context?.tenant) return <Brand />

    return (
      <TenantSwitcher
        tenants={await tenancy.tenants()}
        current={context.tenant}
        label={tenancy.label ?? 'Teams'}
        choose={switchTenant.bind(null, path)}
      />
    )
  }

  function Brand() {
    const Logo = definition.logo ?? LayoutDashboard

    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" render={<Link href={path as never} />}>
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Logo className="size-4" />
            </div>
            <span className="truncate font-semibold">{title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  async function User() {
    await connection()

    const user = (await authorize()) ? await definition.user?.() : null

    if (!user) return null

    return <UserMenu user={user} {...(definition.signOut ? { signOut: signOut.bind(null, path) } : {})} />
  }

  function Layout({ children }: { children: ReactNode }) {
    const nav = [
      { href: path, label: 'Dashboard', icon: <LayoutDashboard />, exact: true },
      ...resources.map((resource) => {
        const Icon = resource.icon ?? Table2

        return { href: to(resource.name), label: resource.label, icon: <Icon /> }
      }),
    ]

    return (
      <TooltipProvider>
        {definition.modeToggle !== false && <script dangerouslySetInnerHTML={{ __html: themeScript }} />}
        <SidebarProvider>
          <Sidebar collapsible="icon">
            <SidebarHeader>
              {tenancy ? (
                <Suspense fallback={<SidebarMenuSkeleton showIcon />}>
                  <Tenants />
                </Suspense>
              ) : (
                <Brand />
              )}
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>{title}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <PanelNav items={nav} />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            {definition.user && (
              <SidebarFooter>
                <Suspense fallback={<SidebarMenuSkeleton showIcon />}>
                  <User />
                </Suspense>
              </SidebarFooter>
            )}
            <SidebarRail />
          </Sidebar>
          <SidebarInset>
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
              <PanelBreadcrumbs root={path} title={title} labels={Object.fromEntries(resources.map((resource) => [resource.name, resource.label]))} />
              <div className="ml-auto">{definition.modeToggle !== false && <ModeToggle />}</div>
            </header>
            <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</main>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    )
  }

  async function DashboardBody() {
    const context = await enter()
    const counts = await Promise.all(
      resources.map(async (resource) => {
        const { total } = await resource.source.list({ dir: 'asc', page: 1, perPage: 1, filters: {}, searchable: [] }, context)

        return { resource, total }
      }),
    )

    return (
      <>
        <Heading title="Dashboard" description={context.tenant ? `Everything in ${context.tenant.name}.` : 'Everything in the panel, at a glance.'} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {counts.map(({ resource, total }) => {
            const Icon = resource.icon ?? Table2

            return (
              <Link key={resource.name} href={to(resource.name) as never} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardDescription>{resource.label}</CardDescription>
                    <CardTitle className="text-3xl font-semibold tabular-nums">{total.toLocaleString('en')}</CardTitle>
                    <CardAction>
                      <Icon className="size-4 text-muted-foreground" />
                    </CardAction>
                  </CardHeader>
                </Card>
              </Link>
            )
          })}
        </div>
        {plugins.some((plugin) => plugin.widgets?.length) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {plugins.flatMap((plugin) =>
              (plugin.widgets ?? []).map(({ title: widgetTitle, description, component: Widget }, index) => (
                <Card key={`${plugin.name}:${index}`}>
                  <CardHeader>
                    <CardTitle>{widgetTitle}</CardTitle>
                    {description && <CardDescription>{description}</CardDescription>}
                  </CardHeader>
                  <CardContent>
                    <Widget tenant={context.tenant} />
                  </CardContent>
                </Card>
              )),
            )}
          </div>
        )}
      </>
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
    const { q, sort, dir, page, ...rest } = search
    const filters: Record<string, string> = Object.fromEntries(
      Object.entries(rest).flatMap(([key, value]) =>
        typeof value === 'string' && value !== '' && resource.filters.some((filter) => filter.key === key) ? [[key, value]] : [],
      ),
    )
    const sortable = resource.columns.some((column) => column.sortable && column.key === sort) ? sort : undefined
    const server = resource.mode === 'server'
    const searchable = resource.columns.filter((column) => column.searchable).map((column) => column.key)
    const { rows, total } = await resource.source.list(
      server
        ? { ...(q ? { q } : {}), ...(sortable ? { sort: sortable } : {}), dir, page, perPage: resource.perPage, filters, searchable }
        : { dir: 'asc', page: 1, perPage: null, filters: {}, searchable },
      context,
    )

    const drawn: TableRowData[] = await Promise.all(
      rows.map(async (row) => {
        const id = String(row[resource.key])

        return {
          id,
          cells: Object.fromEntries(
            await Promise.all(resource.columns.map(async (column) => [column.key, await draw(column, row[column.key], row)] as const)),
          ),
          values: Object.fromEntries(resource.columns.map((column) => [column.key, plain(row[column.key])])),
          ...(resource.readOnly
            ? {}
            : { edit: to(resource.name, encodeURIComponent(id)), remove: deleteRecord.bind(null, path, resource.name, id) }),
        }
      }),
    )

    return (
      <DataTable
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
        perPage={resource.perPage}
        query={{ q: q ?? '', ...(sortable ? { sort: sortable } : {}), dir, page, filters }}
        filters={resource.filters}
        noun={{ one: resource.singular, many: resource.label }}
      />
    )
  }

  const Table = section('admin-table', TableBody)

  async function IndexBody({ params, searchParams }: Props<{ resource: string }, ListSearch>) {
    const { resource } = await enter((await params).resource)

    return (
      <>
        <Heading
          title={resource.label}
          {...(resource.description ? { description: resource.description } : {})}
          action={
            !resource.readOnly && (
              <Button nativeButton={false} render={<Link href={to(resource.name, 'new') as never} />}>
                <Plus />
                New {resource.singular.toLowerCase()}
              </Button>
            )
          }
        />
        <Table params={params} searchParams={searchParams} />
      </>
    )
  }

  async function CreateBody({ params }: Props<{ resource: string }>) {
    const { resource } = await enter((await params).resource)

    if (resource.readOnly) notFound()

    return (
      <>
        <Heading title={`New ${resource.singular.toLowerCase()}`} description={`Add a ${resource.singular.toLowerCase()} to ${resource.label.toLowerCase()}.`} />
        <ResourceForm
          action={saveRecord.bind(null, path, resource.name, null)}
          fields={resource.fields}
          values={{}}
          submit={`Create ${resource.singular.toLowerCase()}`}
          cancel={to(resource.name)}
        />
      </>
    )
  }

  async function EditBody({ params }: Props<{ resource: string; id: string }>) {
    const { resource: name, id } = await params
    const { resource, context } = await enter(name)
    const record = resource.readOnly ? null : await resource.source.find(id, context)

    if (!record) notFound()

    return (
      <>
        <Heading title={String(record[resource.title])} description={`Edit this ${resource.singular.toLowerCase()}.`} />
        <ResourceForm
          action={saveRecord.bind(null, path, resource.name, id)}
          fields={resource.fields}
          values={record}
          submit="Save changes"
          cancel={to(resource.name)}
        />
      </>
    )
  }

  // The pages read their url above everything they show, so each waits inside
  // a boundary of its own: the build stores the skeleton as the page's shell,
  // and a page that awaited params above every boundary would fail it. A
  // panel cannot put a loading.tsx beside the app's route files; this is that.
  function Dashboard() {
    return (
      <Suspense fallback={<PageSkeleton kind="dashboard" />}>
        <DashboardBody />
      </Suspense>
    )
  }

  function Index(props: Props<{ resource: string }, ListSearch>) {
    return (
      <Suspense fallback={<PageSkeleton kind="table" />}>
        <IndexBody {...props} />
      </Suspense>
    )
  }

  function Create(props: Props<{ resource: string }>) {
    return (
      <Suspense fallback={<PageSkeleton kind="form" />}>
        <CreateBody {...props} />
      </Suspense>
    )
  }

  function Edit(props: Props<{ resource: string; id: string }>) {
    return (
      <Suspense fallback={<PageSkeleton kind="form" />}>
        <EditBody {...props} />
      </Suspense>
    )
  }

  return { path, resources, middleware, Layout, Dashboard, Index, Table, Create, Edit }
}

export type Panel = ReturnType<typeof definePanel>

function Heading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

function PageSkeleton({ kind }: { kind: 'dashboard' | 'table' | 'form' }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      {kind === 'dashboard' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      )}
      {kind === 'table' && (
        <>
          <Skeleton className="h-8 w-full sm:max-w-xs" />
          <Skeleton className="h-80 w-full rounded-lg" />
        </>
      )}
      {kind === 'form' && <Skeleton className="h-96 w-full max-w-2xl rounded-xl" />}
    </div>
  )
}

const money = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' })
const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

async function draw(column: Column, value: unknown, row: unknown): Promise<ReactNode> {
  if (column.cell) return column.cell(value, row)

  switch (column.format) {
    case 'money':
      return <span className="tabular-nums">{money.format(Number(value))}</span>
    case 'badge':
      return value === null || value === undefined || value === '' ? null : <Badge variant="secondary">{String(value)}</Badge>
    case 'boolean':
      return <Badge variant={value ? 'default' : 'outline'}>{value ? 'Yes' : 'No'}</Badge>
    case 'date': {
      const at = value instanceof Date ? value : new Date(String(value))

      return Number.isNaN(at.getTime()) ? String(value ?? '') : <time dateTime={at.toISOString()}>{date.format(at)}</time>
    }
    default:
      return String(value ?? '')
  }
}

/** A value the browser can sort and search by. */
function plain(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value

  return String(value)
}
