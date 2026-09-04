'use client'

import Link from '@rsc-router/core/Link'
import { usePathname } from '@rsc-router/core/usePathname'

const links = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/posts/hello-world', label: 'A Post' },
]

export function Nav() {
  const pathname = usePathname()

  return (
    <nav>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={pathname === link.href ? 'active' : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
