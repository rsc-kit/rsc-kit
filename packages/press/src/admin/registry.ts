import { callPlugin, manifestProblems, publicHttps, resourcesOf, wantsChange } from '../installable.js'
import type { Installs } from '../installable.js'
import type { PanelPlugin, RecordChange } from '../plugin.js'
import { tell } from '../plugin.js'
import type { Resource, SourceContext, Tenant } from '../resource.js'

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
  /** Plugins installed while it runs, or null when the panel takes none. */
  installs: Installs | null
}

/** Where a panel may send a plugin's calls: the app's rule, or https to a public name. */
export function allowOf(panel: PanelHandle): (url: URL) => boolean {
  return panel.installs?.allow ?? publicHttps
}

/**
 * The panel's resources for this request: its own, then each installed
 * plugin's for this tenant. A plugin whose manifest no longer fits - the app
 * renamed a resource it reads, or added one with its name - is left out and
 * said so, rather than failing every page.
 */
export async function resourcesFor(panel: PanelHandle, context: SourceContext): Promise<Resource[]> {
  if (!panel.installs) return panel.resources

  const host = panel.resources.map((resource) => resource.name)
  const installed: Resource[] = []
  const taken = new Set(host)

  for (const installation of await panel.installs.store.list(context.tenant)) {
    const problems = manifestProblems(installation.manifest, installation.manifestUrl, host)
    const names = installation.manifest.resources.map((resource) => resource.name)

    if (problems.length > 0 || names.some((name) => taken.has(name))) {
      console.error(`[admin] the installed plugin ${installation.manifest.name} is left out: ${problems.join('; ') || 'a resource name is taken'}`)
      continue
    }

    names.forEach((name) => taken.add(name))
    installed.push(...resourcesOf(installation, allowOf(panel)))
  }

  return [...panel.resources, ...installed]
}

/**
 * A change, told to the build-time plugins and to each installed plugin that
 * asked for it. An installed plugin is told within three seconds or not at
 * all: it is somebody else's server, and the person saving is not waiting
 * for it.
 */
export async function tellAll(panel: PanelHandle, change: RecordChange, context: SourceContext): Promise<void> {
  await tell(panel.plugins, change)

  if (!panel.installs) return

  const listening = (await panel.installs.store.list(context.tenant)).filter((installation) => wantsChange(installation, change))

  await Promise.all(
    listening.map((installation) =>
      callPlugin(installation, { type: 'change', change: { ...change, tenant: context.tenant } }, context, allowOf(panel), 3000).catch((error: unknown) =>
        console.error(`[admin] the installed plugin ${installation.manifest.name} was not told of ${change.change} ${change.resource} ${change.id}`, error),
      ),
    ),
  )
}

/**
 * Panels by path. An action receives a path, not a panel - only what can be
 * serialised crosses to the browser and back - so the panel is looked up here.
 * On globalThis because a dev server can evaluate this module more than once,
 * and a second copy of the map would hold no panels.
 */
const KEY = Symbol.for('@rsc-kit/press.panels')
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

  const resource = (await resourcesFor(panel, context)).find((candidate) => candidate.name === name)

  if (!resource) throw new Error(`[admin] no resource ${name} in the panel at ${path}`)

  if (resource.readOnly) throw new Error(`[admin] ${name} is read-only`)

  return { resource, context }
}
