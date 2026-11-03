import { definePlugin } from '@rsc-kit/press'
import type { RecordChange, Tenant } from '@rsc-kit/press'

/**
 * A whole plugin: a reaction to every save and delete, and a dashboard
 * widget showing them. Published as a package, this file is all it would be -
 * export the function, and an app installs it with plugins: [auditLog()].
 * It keeps entries in memory; a real one would write to a table or an API.
 */
export function auditLog({ keep = 50 }: { keep?: number } = {}) {
  const entries: (RecordChange & { at: Date })[] = []

  function Recent({ tenant }: { tenant: Tenant | null }) {
    const mine = entries.filter((entry) => entry.tenant?.id === tenant?.id).slice(0, 6)

    if (mine.length === 0) return <p className="text-sm text-muted-foreground">Nothing changed yet. Save or delete a record and it shows here.</p>

    return (
      <ul className="space-y-2 text-sm">
        {mine.map((entry, index) => (
          <li key={index} className="flex items-center justify-between gap-4">
            <span>
              <span className="font-medium capitalize">{entry.change}</span> {entry.resource} #{entry.id}
            </span>
            <time className="text-muted-foreground tabular-nums">{entry.at.toLocaleTimeString('en-US')}</time>
          </li>
        ))}
      </ul>
    )
  }

  return definePlugin({
    name: 'audit-log',
    widgets: [{ title: 'Recent activity', description: 'Every save and delete in this team.', component: Recent }],
    onChange(change) {
      entries.unshift({ ...change, at: new Date() })
      entries.length = Math.min(entries.length, keep)
    },
  })
}
