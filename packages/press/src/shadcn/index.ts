import type { AdminTheme } from '../admin/theme.js'
import type { FormsTheme } from '../forms/theme.js'
import { PanelBreadcrumbs } from './breadcrumbs.js'
import { DataTable } from './data-table.js'
import { PanelNav } from './nav.js'
import { BlueprintForm } from './blueprint-form.js'
import { Brand, Cell, Dashboard, Form, Index, Loading, Plugins, Shell } from './pages.js'
import { TenantSwitcher } from './tenant-switcher.js'
import { UserMenu } from './user-menu.js'

/**
 * Panels and blueprints' forms drawn with shadcn/ui: its sidebar layout, data table, fields and
 * cards, in the app's own theme variables, so it follows the app's colours,
 * radius, fonts and dark mode. Its classes reach the app's stylesheet through
 *
 *     @import "@rsc-kit/press/shadcn.css";
 */
export const shadcn: AdminTheme & FormsTheme = {
  Shell,
  Brand,
  TenantSwitcher,
  Nav: PanelNav,
  Breadcrumbs: PanelBreadcrumbs,
  UserMenu,
  Dashboard,
  Index,
  Table: DataTable,
  Form,
  Plugins,
  Cell,
  Loading,
  BlueprintForm,
}
