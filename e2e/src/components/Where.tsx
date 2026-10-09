'use client'

import { usePathname } from '@rsc-kit/core/usePathname'

// What a sidebar link or a breadcrumb reads: the url this page is for.
export function Where() {
  return <code id="where">{usePathname()}</code>
}
