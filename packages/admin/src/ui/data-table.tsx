'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import {
  type ColumnDef,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
  columnVisibilityFeature,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import Link from '@rsc-kit/core/Link'
import { visit } from '@rsc-kit/core/router'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react'
import type { Filter, TableMode } from '../resource.js'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog.js'
import { Button } from '../components/ui/button.js'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js'
import { Input } from '../components/ui/input.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.js'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js'

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

/** What a server-mode table is showing: the url's state, as the page read it. */
export interface TableQuery {
  q: string
  sort?: string
  dir: 'asc' | 'desc'
  page: number
  filters: Record<string, string>
}

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
})

type Features = typeof features

const ALL = '__all__'

/**
 * Every resource's table. One component for both modes, so a table looks and
 * behaves the same wherever its rows are searched:
 *
 *   server  the url is the state. Typing, a filter, a header and the pager
 *           each visit a url, the page asks the source for one page, and a
 *           link works with no javascript and can be shared.
 *   client  every row arrived at once; search, filters, sort and the pager
 *           happen here, with no request.
 */
export function DataTable({
  mode,
  href,
  columns,
  rows,
  total,
  perPage,
  query,
  filters,
  noun,
}: {
  mode: TableMode
  href: string
  columns: TableColumn[]
  rows: TableRowData[]
  total: number
  perPage: number
  query: TableQuery
  filters: Filter[]
  noun: { one: string; many: string }
}) {
  const server = mode === 'server'
  const [q, setQ] = useState(query.q)
  const [chosen, setChosen] = useState<Record<string, string>>(query.filters)
  const [sorting, setSorting] = useState<SortingState>(query.sort ? [{ id: query.sort, desc: query.dir === 'desc' }] : [])
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(() =>
    Object.fromEntries(columns.filter((column) => !column.visible).map((column) => [column.key, false])),
  )
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: server ? query.page - 1 : 0, pageSize: perPage })
  const [confirming, setConfirming] = useState<TableRowData | null>(null)
  const [deleting, startDelete] = useTransition()
  const [, startVisit] = useTransition()

  // Server mode: the url this state names. Empty values are left out, so a
  // cleared search is the plain list url and not ?q=.
  const urlFor = (changes: Partial<Omit<TableQuery, 'filters'>> & { filters?: Record<string, string> }) => {
    const next = { ...query, q, filters: chosen, ...changes }
    const search = new URLSearchParams()

    if (next.q) search.set('q', next.q)
    if (next.sort) search.set('sort', next.sort)
    if (next.sort && next.dir === 'desc') search.set('dir', 'desc')
    if (next.page > 1) search.set('page', String(next.page))
    for (const [key, value] of Object.entries(next.filters)) if (value) search.set(key, value)

    const qs = search.toString()

    return qs ? `${href}?${qs}` : href
  }

  const go = (url: string) => startVisit(() => void visit(url as never, { replace: true }))

  // Typing searches after a pause, not per keystroke; the page resets to the first.
  const typed = useRef(false)

  useEffect(() => {
    if (!server || !typed.current) return

    const timer = setTimeout(() => go(urlFor({ q, page: 1 })), 300)

    return () => clearTimeout(timer)
  }, [q])

  // Client mode: search and filters here, before the table sorts and pages.
  const visible = useMemo(() => {
    if (server) return rows

    const needle = q.trim().toLowerCase()
    const searchable = columns.filter((column) => column.searchable).map((column) => column.key)

    return rows.filter(
      (row) =>
        Object.entries(chosen).every(([key, value]) => !value || String(row.values[key]) === value) &&
        (!needle || searchable.some((key) => String(row.values[key] ?? '').toLowerCase().includes(needle))),
    )
  }, [server, rows, q, chosen, columns])

  const columnDefs = useMemo<ColumnDef<Features, TableRowData>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        accessorFn: (row: TableRowData) => row.values[column.key],
        header: column.label,
        cell: ({ row }: { row: { original: TableRowData } }) => row.original.cells[column.key],
        enableSorting: column.sortable,
        enableHiding: true,
        sortFn: (a, b, id) => compare(a.getValue(id), b.getValue(id)),
      })) as ColumnDef<Features, TableRowData>[],
    [columns],
  )

  const table = useTable({
    features,
    data: visible,
    columns: columnDefs,
    getRowId: (row: TableRowData) => row.id,
    manualSorting: server,
    manualPagination: server,
    ...(server ? { pageCount: Math.max(1, Math.ceil(total / perPage)) } : {}),
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: setColumnVisibility,
    state: { sorting, pagination, columnVisibility },
  })

  const searchable = columns.some((column) => column.searchable)
  const hasActions = rows.some((row) => row.edit || row.remove)
  const pageCount = server ? Math.max(1, Math.ceil(total / perPage)) : Math.max(1, table.getPageCount())
  const page = server ? query.page : pagination.pageIndex + 1
  const count = server ? total : visible.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          // A form, so Enter searches and a server-mode search works before
          // the page has javascript: it is a GET of the list url.
          <form
            action={href}
            method="get"
            className="relative w-full sm:max-w-xs"
            onSubmit={(event) => {
              event.preventDefault()
              if (server) go(urlFor({ q, page: 1 }))
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              type="search"
              placeholder={`Search ${noun.many.toLowerCase()}…`}
              aria-label={`Search ${noun.many.toLowerCase()}`}
              className="pl-8"
              value={q}
              onChange={(event) => {
                typed.current = true
                setQ(event.target.value)
                if (!server) table.setPageIndex(0)
              }}
            />
          </form>
        )}
        {filters.map((filter) => (
          <Select
            key={filter.key}
            items={[{ value: ALL, label: `All ${filter.label.toLowerCase()}` }, ...filter.options.map((option) => ({ value: option, label: option }))]}
            value={chosen[filter.key] || ALL}
            onValueChange={(value) => {
              const next = { ...chosen, [filter.key]: value === ALL || value === null ? '' : String(value) }

              setChosen(next)
              if (server) go(urlFor({ filters: next, page: 1 }))
              else table.setPageIndex(0)
            }}
          >
            <SelectTrigger aria-label={filter.label} className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All {filter.label.toLowerCase()}</SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="ml-auto" />}>
            <Columns3 />
            <span className="hidden sm:inline">Columns</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {columns.find((candidate) => candidate.key === column.id)?.label}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const column = header.column
                  const label = columns.find((candidate) => candidate.key === column.id)?.label
                  const sorted = server ? (query.sort === column.id ? query.dir : false) : column.getIsSorted()
                  const Arrow = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown

                  return (
                    <TableHead key={header.id} aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}>
                      {!column.getCanSort() ? (
                        label
                      ) : server ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2.5 h-8"
                          nativeButton={false}
                          render={<Link href={urlFor({ sort: column.id, dir: sorted === 'asc' ? 'desc' : 'asc', page: 1 }) as never} replace />}
                        >
                          {label}
                          <Arrow className={sorted ? undefined : 'text-muted-foreground/60'} />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="-ml-2.5 h-8" onClick={() => column.toggleSorting(sorted === 'asc')}>
                          {label}
                          <Arrow className={sorted ? undefined : 'text-muted-foreground/60'} />
                        </Button>
                      )}
                    </TableHead>
                  )
                })}
                {hasActions && (
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                  {hasActions && (
                    <TableCell className="text-right">
                      <RowActions row={row.original} onDelete={() => setConfirming(row.original)} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length + (hasActions ? 1 : 0)} className="h-24 text-center text-muted-foreground">
                  No {noun.many.toLowerCase()} found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {count} {count === 1 ? noun.one.toLowerCase() : noun.many.toLowerCase()}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          {server ? (
            <>
              <Pager to={page > 1 ? urlFor({ page: page - 1 }) : null} label="Previous page">
                <ChevronLeft />
              </Pager>
              <Pager to={page < pageCount ? urlFor({ page: page + 1 }) : null} label="Next page">
                <ChevronRight />
              </Pager>
            </>
          ) : (
            <>
              <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
                <ChevronRight />
              </Button>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && !deleting && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {noun.one.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>It is removed for good. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() =>
                startDelete(async () => {
                  await confirming?.remove?.()
                  setConfirming(null)
                })
              }
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Pager({ to, label, children }: { to: string | null; label: string; children: ReactNode }) {
  if (!to) {
    return (
      <Button variant="outline" size="icon-sm" aria-label={label} disabled>
        {children}
      </Button>
    )
  }

  return <Button variant="outline" size="icon-sm" aria-label={label} nativeButton={false} render={<Link href={to as never} replace />}>{children}</Button>
}

function RowActions({ row, onDelete }: { row: TableRowData; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {row.edit && (
          <DropdownMenuItem render={<Link href={row.edit as never} />}>
            <Pencil />
            Edit
          </DropdownMenuItem>
        )}
        {row.edit && row.remove && <DropdownMenuSeparator />}
        {row.remove && (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)

  return String(a).localeCompare(String(b), undefined, { numeric: true })
}
