'use client'

import { Fragment } from 'react'
import Link from '@rsc-kit/core/Link'
import { usePathname } from '@rsc-kit/core/usePathname'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb.js'

/**
 * Where you are, from the url: Admin / Products / Edit. In the layout, which
 * stays mounted across pages, so it reads the path rather than being told.
 */
export function PanelBreadcrumbs({ root, title, labels }: { root: string; title: string; labels: Record<string, string> }) {
  const pathname = usePathname()
  const parts = pathname.startsWith(root) ? pathname.slice(root.length).split('/').filter(Boolean) : []
  const crumbs = [{ href: root, label: title }]

  if (parts[0]) crumbs.push({ href: `${root}/${parts[0]}`, label: labels[parts[0]] ?? parts[0] })
  if (parts[1]) crumbs.push({ href: pathname, label: parts[1] === 'new' ? 'New' : 'Edit' })

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.href}>
            {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
            <BreadcrumbItem className={index < crumbs.length - 1 ? 'hidden md:block' : undefined}>
              {index === crumbs.length - 1 ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink render={<Link href={crumb.href as never} />}>{crumb.label}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
