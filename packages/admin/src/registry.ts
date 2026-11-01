import type { PanelPlugin } from './plugin.js'
import type { Resource, SourceContext, Tenant } from './resource.js'

/**
 * Tenants: whose records the panel is showing. The panel never stores which
 * one is current - the app already knows, in its session, a cookie, the
 * user's row - so it asks, and tells the app when the visitor switches.
 */
export interface Tenancy {
  /** What a tenant is called in the switcher: 'Team', 'Store', 'Workspace'. */
  label?: string
  /** The tenants this visitor belongs to. */
  tenants: () => Tenant[] | Promise<Tenant[]>
  /** The one they are working in. Null - none chosen, or no longer theirs - is a 404. */
  current: () => Tenant | null | Promise<Tenant | null>
  /** Remember the visitor's choice. Runs in a server action, so it may set a cookie. */
  switch: (id: string) => void | Promise<void>
}

/** What an action needs of a panel: its resources, who may use them, and whose rows they are. */
export interface PanelHandle {
  path: string
  resources: Resource[]
  authorize: () => boolean | Promise<boolean>
  plugins: PanelPlugin[]
  tenancy: Tenancy | null
  signOut: (() => void | Promise<void>) | null
}

/**
 * Panels by path. An action receives a path, not a panel - only what can be
 * serialised crosses to the browser and back - so the panel is looked up here.
 * On globalThis because a dev server can evaluate this module more than once,
 * and a second copy of the map would hold no panels.
 */
const KEY = Symbol.for('@rsc-kit/admin.panels')
const panels: Map<string, PanelHandle> = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map()) as Map<string, PanelHandle>

export function registerPanel(panel: PanelHandle): void {
  panels.set(panel.path, panel)
}

export function panelAt(path: string): PanelHandle {
  const panel = panels.get(path)

  if (!panel) throw new Error(`[admin] no panel at ${path}; definePanel({ path: ${JSON.stringify(path)} }) has not run`)

  return panel
}

/**
 * Who is asking, as a data source is told. In a panel with tenants, the
 * current tenant must be one of the visitor's - an app whose current() reads
 * a cookie would otherwise hand anyone the tenant the cookie names.
 */
export async function contextOf(panel: PanelHandle): Promise<SourceContext | null> {
  if (!panel.tenancy) return { tenant: null }

  const tenant = await panel.tenancy.current()

  if (!tenant) return null

  const theirs = await panel.tenancy.tenants()

  return theirs.some((candidate) => candidate.id === tenant.id) ? { tenant } : null
}

/** The resource and its context, once the visitor is allowed into the panel - and allowed to change it. */
export async function allowedResource(path: string, name: string): Promise<{ resource: Resource; context: SourceContext }> {
  const panel = panelAt(path)

  if (!(await panel.authorize())) throw new Error('[admin] not allowed')

  const context = await contextOf(panel)

  if (!context) throw new Error('[admin] no tenant chosen, or not one of this visitor\'s')

  const resource = panel.resources.find((candidate) => candidate.name === name)

  if (!resource) throw new Error(`[admin] no resource ${name} in the panel at ${path}`)

  if (resource.readOnly) throw new Error(`[admin] ${name} is read-only`)

  return { resource, context }
}
