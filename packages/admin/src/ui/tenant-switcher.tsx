'use client'

import { useTransition } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { Tenant } from '../resource.js'
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '../components/ui/sidebar.js'

function TenantAvatar({ tenant }: { tenant: Tenant }) {
  return (
    <Avatar className="size-8 rounded-lg">
      {tenant.avatar && <AvatarImage src={tenant.avatar} alt={tenant.name} />}
      <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        {tenant.name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

/** The sidebar's header in a panel with tenants: who you are working for, and the others you could be. */
export function TenantSwitcher({
  tenants,
  current,
  label,
  choose,
}: {
  tenants: Tenant[]
  current: Tenant
  label: string
  choose: (id: string) => Promise<unknown>
}) {
  const { isMobile } = useSidebar()
  const [pending, start] = useTransition()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                aria-busy={pending || undefined}
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <TenantAvatar tenant={current} />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{current.name}</span>
              {current.description && <span className="truncate text-xs text-muted-foreground">{current.description}</span>}
            </div>
            <ChevronsUpDown className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56 rounded-lg" align="start" side={isMobile ? 'bottom' : 'right'} sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
              {tenants.map((tenant) => (
                <DropdownMenuItem
                  key={tenant.id}
                  className="gap-2 p-2"
                  disabled={pending}
                  onClick={() => tenant.id !== current.id && start(async () => void (await choose(tenant.id)))}
                >
                  <TenantAvatar tenant={tenant} />
                  <span className="flex-1 truncate">{tenant.name}</span>
                  {tenant.id === current.id && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
