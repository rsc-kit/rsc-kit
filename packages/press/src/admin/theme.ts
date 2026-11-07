import type { ComponentType, ReactNode } from 'react'
import type { Field, Filter, Format, TableMode, Tenant } from '../resource.js'

/**
 * What a theme draws for an admin panel. The panel decides everything else:
 * who may see a page, which rows, which tenant, what a button does. A theme
 * is handed the result as props and draws it.
 *
 * Every prop is data, a server action already bound to its record, or an
 * element already drawn - never a component. A theme's component may be a
 * client component, and a component cannot cross to the browser; the
 * element it draws can.
 *
 * The panel owns the Suspense boundaries, because it knows which parts read
 * the request; a theme draws what shows meanwhile, as `Loading`.
 */
export interface AdminTheme {
  /** The frame every page sits in: navigation, header, the page itself. */
  Shell: ComponentType<ShellProps>
  /** The panel's name and mark, where a panel with tenants has its switcher. */
  Brand: ComponentType<BrandProps>
  TenantSwitcher: ComponentType<TenantSwitcherProps>
  /** The panel's links, lit up for the page the visitor is on - which only the browser knows. */
  Nav: ComponentType<{ items: NavItem[] }>
  /** Where the visitor is, read from the url: Admin / Products / Edit. */
  Breadcrumbs: ComponentType<BreadcrumbsProps>
  UserMenu: ComponentType<UserMenuProps>

  Dashboard: ComponentType<DashboardProps>
  /** A resource's list page around its table. */
  Index: ComponentType<IndexProps>
  /** A resource's rows: searching, sorting, paging, filters and bulk actions, in either mode. */
  Table: ComponentType<TableProps>
  /** A create or edit page, and its form. */
  Form: ComponentType<FormProps>
  Plugins: ComponentType<PluginsProps>

  /** A value in a column with a format: money, a badge, yes or no, a date. A column's own cell() is drawn instead. */
  Cell: ComponentType<{ format: Exclude<Format, 'text' | 'relation'>; value: unknown }>
  /** What shows while a page, or a part of the shell, waits for the request. */
  Loading: ComponentType<{ kind: 'dashboard' | 'table' | 'form' | 'menu' }>
}

export interface ShellProps {
  title: string
  /** The Brand, or the TenantSwitcher. */
  brand: ReactNode
  /** The Nav. */
  nav: ReactNode
  /** The UserMenu, in a panel that knows who is signed in. */
  user: ReactNode | null
  /** The Breadcrumbs. */
  crumbs: ReactNode
  /** The light and dark switch: off when the app has its own. */
  modeToggle: boolean
  children: ReactNode
}

export interface BrandProps {
  href: string
  title: string
  /** The app's mark, drawn; absent when the panel was given none. */
  logo?: ReactNode
}

export interface TenantSwitcherProps {
  tenants: Tenant[]
  current: Tenant
  /** What the tenants are called: Teams. */
  label: string
  choose: (id: string) => Promise<unknown>
}

export interface NavItem {
  href: string
  label: string
  /**
   * What the link leads to, for the theme's default icon. `installed` is a
   * resource a plugin installed while the panel ran.
   */
  kind: 'dashboard' | 'resource' | 'installed' | 'plugins'
  /** The resource's own icon, drawn. */
  icon?: ReactNode
  /** Exact for the dashboard, so it is not lit up on every page below it. */
  exact?: boolean
}

export interface BreadcrumbsProps {
  /** The panel's path. */
  root: string
  title: string
  /** Each first segment's label: { products: 'Products' }. */
  labels: Record<string, string>
}

export interface PanelUser {
  name: string
  email?: string
  avatar?: string
}

export interface UserMenuProps {
  user: PanelUser
  signOut?: () => Promise<unknown>
}

export interface DashboardProps {
  description: string
  counts: {
    name: string
    label: string
    href: string
    /** Null when the source could not be counted: an installed plugin's server that is down. */
    total: number | null
    icon?: ReactNode
  }[]
  /** Each plugin widget, already rendered for this tenant. */
  widgets: { key: string; title: string; description?: string; content: ReactNode }[]
}

export interface IndexProps {
  title: string
  description?: string
  /** The new-record link, absent for a read-only resource. */
  create?: { href: string; label: string }
  /** The Table, as a section the panel refreshes on its own. */
  table: ReactNode
}

/** A column as the browser needs it: what to call it, and what it may do. The cells come drawn. */
export interface TableColumn {
  key: string
  label: string
  sortable: boolean
  searchable: boolean
  visible: boolean
}

/**
 * A row, drawn on the server: each cell is already the element it shows -
 * a money format, a badge, a column's own cell() - and `values` are the raw
 * values the browser sorts and searches by in a client-mode table.
 */
export interface TableRowData {
  id: string
  cells: Record<string, ReactNode>
  values: Record<string, string | number | boolean | null>
  edit?: string
  remove?: () => Promise<unknown>
}

/** A bulk action as the table offers it; the work is the server's. */
export interface TableBulkAction {
  name: string
  label: string
  destructive: boolean
}

/** What a server-mode table is showing: the url's state, as the page read it. */
export interface TableQuery {
  q: string
  sort?: string
  dir: 'asc' | 'desc'
  page: number
  filters: Record<string, string>
}

export interface TableProps {
  /**
   *   server  the url is the state. Typing, a filter, a header and the pager
   *           each visit a url, the page asks the source for one page, and a
   *           link works with no javascript and can be shared.
   *   client  every row arrived at once; search, filters, sort and the pager
   *           happen in the browser, with no request.
   */
  mode: TableMode
  /** The list's url, which a server-mode table visits with its state. */
  href: string
  columns: TableColumn[]
  rows: TableRowData[]
  /** Every row the query matches, or null from a source that pages by cursor and does not count. */
  total: number | null
  /**
   * A list paged by cursor: the urls of the pages either side, null at an
   * end. Present, the pager follows these and there are no page numbers.
   */
  cursors?: { prev: string | null; next: string | null }
  perPage: number
  query: TableQuery
  filters: Filter[]
  noun: { one: string; many: string }
  /** Ticking rows, and what can be done to them. Absent for a read-only resource. */
  bulk?: { actions: TableBulkAction[]; run: (action: string, ids: string[]) => Promise<unknown> }
}

export interface FormProps {
  title: string
  description: string
  /** Saves the record. A refusal is a 422 whose messages belong under their fields. */
  action: (form: FormData) => Promise<unknown>
  /** Each field, a relation's with its choices. */
  fields: Field[]
  /** The record's values; empty on a create page. */
  values: Record<string, unknown>
  /** The submit button's words: Create product, Save changes. */
  submit: string
  /** Where cancelling goes. */
  cancel: string
}

export interface PluginsProps {
  description: string
  /** Whether this visitor may install and uninstall; one who may not sees what is installed. */
  allowed: boolean
  /** Reads a manifest url, sent as the field `manifest`, and puts it under review. */
  review: (form: FormData) => Promise<unknown>
  /** A manifest under review, or why it cannot be installed. */
  reviewing: null | { problem: string } | PluginReview
  installed: InstalledPlugin[]
}

export interface PluginReview {
  label: string
  version?: string
  /** Its description, or its server's host. */
  description: string
  /** The labels of the resources it adds. */
  adds: string[]
  /** What it may reach, in words; empty when it reaches nothing beyond its own records. */
  can: string[]
  endpoint: string
  install: () => Promise<unknown>
  /** Where cancelling the review goes. */
  cancel: string
}

export interface InstalledPlugin {
  id: string
  label: string
  description: string
  /** The labels of the resources it added. */
  resources: string[]
  scopes: string[]
  /** Absent for a visitor who may not uninstall. */
  uninstall?: () => Promise<unknown>
  /**
   * What the plugin needs to tell this panel's calls from anyone else's,
   * shown until someone confirms they copied it.
   */
  secret?: { installation: string; secret: string; copied: () => Promise<unknown> }
}
