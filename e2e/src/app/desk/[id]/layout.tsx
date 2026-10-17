import type { ReactNode } from 'react'
import { Suspense } from 'react'
import Link from '@rsc-kit/core/Link'
import Header from './header.section'
import { Where } from '../../../components/Where'

// The tabbed screen: what is the same on every tab lives here, so a tab switch
// does not take it away. The header is a section because it shows data that
// changes, in its own boundary because it reads the params; the tab bar reads
// the url.
export default function DeskLayout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<header id="desk-header-skeleton">…</header>}>
        <Header params={params} />
      </Suspense>
      <nav id="desk-tabs">
        <Link href="/desk/7/inbox">Inbox</Link>{' '}
        {/* Not prefetched: a tab nobody has loaded yet, which is when its loading state is on screen. */}
        <Link href="/desk/7/archive" prefetch={false}>
          Archive
        </Link>{' '}
        <Where />
      </nav>
      <main id="desk">{children}</main>
    </>
  )
}
