'use client'

import Link from '@rsc-kit/core/Link'
import { usePathname } from '@rsc-kit/core/usePathname'
import type { Href } from '@rsc-kit/core/routes'

// #region links
// `satisfies` rather than a type annotation: an annotation would widen href to
// Href and lose which one each entry is, while this keeps the literals and
// still checks them — so a typo fails here, at the list, rather than at the
// Link that renders it.
const links = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/posts/hello-world', label: 'A Post' },
] satisfies { href: Href; label: string }[]
// #endregion

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
