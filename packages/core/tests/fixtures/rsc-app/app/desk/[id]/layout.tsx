import { Suspense, type ReactNode } from 'react'
import Header from './header.section'

// The part of the screen that must not blink between the pages below it, and
// still has to be current: a section, so a page under it can refresh it by name.
// In its own boundary because it reads params, which a layout may not above all of them.
export default function DeskLayout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  return (
    <div id="desk">
      <Suspense fallback={<header id="desk-header-skeleton" />}>
        <Header params={params} />
      </Suspense>
      {children}
    </div>
  )
}
