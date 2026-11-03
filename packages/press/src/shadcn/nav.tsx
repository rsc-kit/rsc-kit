'use client'

import Link from '@rsc-kit/core/Link'
import { usePathname } from '@rsc-kit/core/usePathname'
import { LayoutDashboard, Puzzle, Table2 } from 'lucide-react'
import type { NavItem } from '../admin/theme.js'
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from './components/ui/sidebar.js'

/** The icon a link has when its resource brought none. */
const icons = { dashboard: LayoutDashboard, resource: Table2, installed: Puzzle, plugins: Puzzle }

/** The sidebar's links, lit up for the page you are on. Closes the sheet on a phone. */
export function PanelNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  return items.map((item) => {
    const Icon = icons[item.kind]
    const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/')

    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton
          isActive={active}
          tooltip={item.label}
          render={<Link href={item.href as never} onClick={() => isMobile && setOpenMobile(false)} />}
        >
          {item.icon ?? <Icon />}
          <span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  })
}
