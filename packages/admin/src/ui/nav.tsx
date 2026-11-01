'use client'

import type { ReactNode } from 'react'
import Link from '@rsc-kit/core/Link'
import { usePathname } from '@rsc-kit/core/usePathname'
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from '../components/ui/sidebar'

export interface NavItem {
  href: string
  label: string
  /** Rendered on the server: an icon component cannot cross to the browser, the element it draws can. */
  icon: ReactNode
  /** Exact for the dashboard, so it is not lit up on every page below it. */
  exact?: boolean
}

/** The sidebar's links, lit up for the page you are on. Closes the sheet on a phone. */
export function PanelNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  return items.map((item) => {
    const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/')

    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton
          isActive={active}
          tooltip={item.label}
          render={<Link href={item.href as never} onClick={() => isMobile && setOpenMobile(false)} />}
        >
          {item.icon}
          <span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  })
}
