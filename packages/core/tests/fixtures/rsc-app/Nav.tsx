'use client'

// Imports Link by the package specifier, so the fixture also covers the
// alias the plugin installs for app code.
// (prefetch on hover + intercepted click -> window.__rsc_navigate).
import Link from '@rsc-router/core/Link'

export function Nav() {
  return (
    <nav>
      <Link href="/" id="nav-home">Home</Link>
      {' | '}
      <Link href="/static" id="nav-static">Static</Link>
      {' | '}
      <Link href="/slow" id="nav-slow" prefetch="none">Slow</Link>
    </nav>
  )
}
