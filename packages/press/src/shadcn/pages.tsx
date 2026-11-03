import type { ReactNode } from 'react'
import Link from '@rsc-kit/core/Link'
import { LayoutDashboard, Plus, Table2 } from 'lucide-react'
import type { BrandProps, DashboardProps, FormProps, IndexProps, PluginsProps, ShellProps } from '../admin/theme.js'
import { Badge } from './components/ui/badge.js'
import { Button } from './components/ui/button.js'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card.js'
import { Separator } from './components/ui/separator.js'
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
} from './components/ui/sidebar.js'
import { Skeleton } from './components/ui/skeleton.js'
import { TooltipProvider } from './components/ui/tooltip.js'
import { FlashToasts } from './flash-toasts.js'
import { ModeToggle } from './mode-toggle.js'
import { ActionButton, ManifestForm, SecretField } from './plugin-forms.js'
import { ResourceForm } from './resource-form.js'
import { themeScript } from './theme-script.js'

/** shadcn's sidebar layout: the sidebar, a header with the trigger and breadcrumbs, the page. */
export function Shell({ title, brand, nav, user, crumbs, modeToggle, children }: ShellProps) {
  return (
    <TooltipProvider>
      {modeToggle && <script dangerouslySetInnerHTML={{ __html: themeScript }} />}
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>{brand}</SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>{title}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>{nav}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          {user && <SidebarFooter>{user}</SidebarFooter>}
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            {crumbs}
            <div className="ml-auto">{modeToggle && <ModeToggle />}</div>
          </header>
          <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
      <FlashToasts />
    </TooltipProvider>
  )
}

export function Brand({ href, title, logo }: BrandProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" render={<Link href={href as never} />}>
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground [&_svg]:size-4">
            {logo ?? <LayoutDashboard />}
          </div>
          <span className="truncate font-semibold">{title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function Heading({ title, description, action }: { title: string; description?: string | undefined; action?: ReactNode }) {
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

export function Dashboard({ description, counts, widgets }: DashboardProps) {
  return (
    <>
      <Heading title="Dashboard" description={description} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {counts.map(({ name, label, href, total, icon }) => (
          <Link key={name} href={href as never} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-3xl font-semibold tabular-nums">{total === null ? '—' : total.toLocaleString('en')}</CardTitle>
                <CardAction className="text-muted-foreground [&_svg]:size-4">{icon ?? <Table2 />}</CardAction>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      {widgets.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {widgets.map(({ key, title, description: about, content }) => (
            <Card key={key}>
              <CardHeader>
                <CardTitle>{title}</CardTitle>
                {about && <CardDescription>{about}</CardDescription>}
              </CardHeader>
              <CardContent>{content}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

export function Index({ title, description, create, table }: IndexProps) {
  return (
    <>
      <Heading
        title={title}
        description={description}
        action={
          create && (
            <Button nativeButton={false} render={<Link href={create.href as never} />}>
              <Plus />
              {create.label}
            </Button>
          )
        }
      />
      {table}
    </>
  )
}

export function Form({ title, description, ...form }: FormProps) {
  return (
    <>
      <Heading title={title} description={description} />
      <ResourceForm {...form} />
    </>
  )
}

export function Plugins({ description, allowed, review, reviewing, installed }: PluginsProps) {
  return (
    <>
      <Heading title="Plugins" description={description} />
      {reviewing && 'problem' in reviewing && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>That plugin cannot be installed</CardTitle>
            <CardDescription>{reviewing.problem}</CardDescription>
          </CardHeader>
        </Card>
      )}
      {reviewing && 'install' in reviewing && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>
              Install {reviewing.label}
              {reviewing.version && <span className="ml-2 font-normal text-muted-foreground">{reviewing.version}</span>}
            </CardTitle>
            <CardDescription>{reviewing.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <div className="grid gap-1">
              <span className="font-medium">It adds</span>
              <span className="text-muted-foreground">{reviewing.adds.join(', ')}</span>
            </div>
            <div className="grid gap-1">
              <span className="font-medium">It can</span>
              {reviewing.can.length === 0 ? (
                <span className="text-muted-foreground">See nothing of yours beyond its own records.</span>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {reviewing.can.map((words) => (
                    <li key={words}>{words}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-1">
              <span className="font-medium">It runs at</span>
              <code className="font-mono text-xs text-muted-foreground">{reviewing.endpoint}</code>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <ActionButton action={reviewing.install} label="Install" busy="Installing…" />
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={reviewing.cancel as never} />}>
              Cancel
            </Button>
          </CardFooter>
        </Card>
      )}
      {installed.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {installed.map((plugin) => (
            <Card key={plugin.id}>
              <CardHeader>
                <CardTitle>{plugin.label}</CardTitle>
                <CardDescription>{plugin.description}</CardDescription>
                {plugin.uninstall && (
                  <CardAction>
                    <ActionButton action={plugin.uninstall} label="Uninstall" busy="Removing…" variant="outline" />
                  </CardAction>
                )}
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="flex flex-wrap gap-1.5">
                  {plugin.resources.map((label) => (
                    <Badge key={label} variant="secondary">
                      {label}
                    </Badge>
                  ))}
                  {plugin.scopes.map((scope) => (
                    <Badge key={scope} variant="outline">
                      {scope}
                    </Badge>
                  ))}
                </div>
                {plugin.secret && (
                  <div className="grid gap-3 rounded-lg border p-3">
                    <p className="text-sm">Give the plugin these, so it can tell this panel's calls from anyone else's. The secret is shown until you confirm.</p>
                    <SecretField installation={plugin.secret.installation} secret={plugin.secret.secret} />
                    <div>
                      <ActionButton action={plugin.secret.copied} label="I've copied it" busy="Saving…" variant="outline" />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {allowed && !(reviewing && 'install' in reviewing) && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Install a plugin</CardTitle>
            <CardDescription>{installed.length === 0 ? 'Nothing is installed yet.' : 'Add another.'}</CardDescription>
          </CardHeader>
          <CardContent>
            <ManifestForm action={review} />
          </CardContent>
        </Card>
      )}
    </>
  )
}

const money = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' })
const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

export function Cell({ format, value }: { format: 'money' | 'badge' | 'boolean' | 'date'; value: unknown }) {
  switch (format) {
    case 'money':
      return <span className="tabular-nums">{money.format(Number(value))}</span>
    case 'badge':
      return value === null || value === undefined || value === '' ? null : <Badge variant="outline">{String(value)}</Badge>
    case 'boolean':
      return <Badge variant={value ? 'default' : 'outline'}>{value ? 'Yes' : 'No'}</Badge>
    case 'date': {
      const at = value instanceof Date ? value : new Date(String(value))

      return Number.isNaN(at.getTime()) ? String(value ?? '') : <time dateTime={at.toISOString()}>{date.format(at)}</time>
    }
  }
}

export function Loading({ kind }: { kind: 'dashboard' | 'table' | 'form' | 'menu' }) {
  if (kind === 'menu') return <SidebarMenuSkeleton showIcon />

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
