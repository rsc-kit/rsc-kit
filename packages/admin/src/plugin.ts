import type { ComponentType } from 'react'
import type { Resource, Tenant } from './resource'

/** What happened to a record, told to every plugin after it happened. */
export interface RecordChange {
  /** The panel's path: '/admin'. */
  panel: string
  resource: string
  id: string
  change: 'created' | 'updated' | 'deleted'
  /** What was saved, as the schema parsed it. Absent for a delete. */
  values?: Record<string, unknown>
  /** Whose record it was, in a panel with tenants. */
  tenant: Tenant | null
}

export interface Widget {
  title: string
  description?: string
  component: ComponentType<{ tenant: Tenant | null }>
}

/**
 * A plugin adds to a panel; it never changes the panel's own code. Everything
 * here is what an app could write itself - a plugin is the same thing in a
 * package, so it can be installed, versioned and sold.
 */
export interface PanelPlugin {
  /** Unique within a panel; a package's name is a good one. */
  name: string
  /** Resources the panel shows as if the app had defined them. */
  resources?: Resource[]
  /**
   * Server components rendered on the dashboard, each in a card, after the
   * counts. A widget is told the tenant, so it shows that tenant's numbers.
   */
  widgets?: Widget[]
  /**
   * Called after a save or a delete has succeeded. A plugin that throws is
   * logged and does not undo the change or fail the request: the record is
   * already written, and the person saving it is not the plugin's audience.
   */
  onChange?: (change: RecordChange) => void | Promise<void>
}

/**
 * Typed, and nothing more: a plugin is a plain object. Export a function that
 * takes the plugin's options and returns one, so an app writes
 * plugins: [auditLog({ keep: 500 })].
 */
export function definePlugin<Plugin extends PanelPlugin>(plugin: Plugin): Plugin {
  return plugin
}

/** Every plugin's onChange, in the order the plugins were given. */
export async function tell(plugins: PanelPlugin[], change: RecordChange): Promise<void> {
  for (const plugin of plugins) {
    try {
      await plugin.onChange?.(change)
    } catch (error) {
      console.error(`[admin] the plugin ${plugin.name} failed on ${change.change} of ${change.resource} ${change.id}`, error)
    }
  }
}
