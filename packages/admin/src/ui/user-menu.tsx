'use client'

import { ChevronsUpDown, LogOut } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '../components/ui/sidebar.js'

export interface PanelUser {
  name: string
  email?: string
  avatar?: string
}

function UserAvatar({ user }: { user: PanelUser }) {
  return (
    <Avatar className="size-8 rounded-lg">
      {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
      <AvatarFallback className="rounded-lg">
        {user.name
          .split(/\s+/)
          .map((word) => word.charAt(0))
          .slice(0, 2)
          .join('')
          .toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

function Who({ user }: { user: PanelUser }) {
  return (
    <div className="grid flex-1 text-left text-sm leading-tight">
      <span className="truncate font-medium">{user.name}</span>
      {user.email && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
    </div>
  )
}

/** The sidebar's footer: who is signed in, and a way out when the app gave one. */
export function UserMenu({ user, signOut }: { user: PanelUser; signOut?: () => Promise<unknown> }) {
  const { isMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />}
          >
            <UserAvatar user={user} />
            <Who user={user} />
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56 rounded-lg" side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <UserAvatar user={user} />
                  <Who user={user} />
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {signOut && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void signOut()}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
