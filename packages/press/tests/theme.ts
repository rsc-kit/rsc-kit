import type { AdminTheme } from '../src/admin/theme'

const nothing = () => null

/** A theme that draws nothing: what the panel decides is tested without any of shadcn. */
export const theme: AdminTheme = {
  Shell: nothing,
  Brand: nothing,
  TenantSwitcher: nothing,
  Nav: nothing,
  Breadcrumbs: nothing,
  UserMenu: nothing,
  Dashboard: nothing,
  Index: nothing,
  Table: nothing,
  Form: nothing,
  Plugins: nothing,
  Cell: nothing,
  Loading: nothing,
}
