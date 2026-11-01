import type { ReactNode } from 'react'
import Link from '@rsc-kit/core/Link'
import { resources } from '../../admin/registry'

const styles = `
.admin { display: grid; grid-template-columns: 180px 1fr; gap: 24px; font-family: system-ui, sans-serif; }
.admin nav a { display: block; padding: 6px 0; }
.admin table { border-collapse: collapse; width: 100%; }
.admin th, .admin td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #ddd; }
.admin-bar { display: flex; gap: 8px; align-items: center; margin: 12px 0; }
.admin-badge { padding: 1px 8px; border-radius: 9px; background: #eef; font-size: 12px; }
.admin-form { display: grid; gap: 12px; max-width: 420px; }
.admin-form label { display: grid; gap: 4px; }
.admin-form .admin-toggle { display: flex; gap: 8px; }
.admin-form small, .admin-form [role=alert] { color: #b00020; }
.admin-inline { display: inline; }
.admin-danger { color: #b00020; }
.admin-pages { display: flex; gap: 12px; margin-top: 12px; }
`

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin">
      <style>{styles}</style>
      <nav>
        <strong>Admin</strong>
        {Object.values(resources).map((resource) => (
          <Link key={resource.name} href={`/admin/${resource.name}` as never}>
            {resource.label}
          </Link>
        ))}
      </nav>
      <main>{children}</main>
    </div>
  )
}
