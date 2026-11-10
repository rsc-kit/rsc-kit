import type { ReactNode } from 'react'
import { PageTransition } from '@rsc-kit/core/PageTransition'
import { ThemeScript } from './ThemeScript'

// What next-themes does under a policy: an inline script in the HTML, and a
// <style> inserted after hydration, both carrying useNonce(). And the
// engine's own PageTransition, whose style React inserts in the browser.
export default function NonceLayout({ children }: { children: ReactNode }) {
  return (
    <PageTransition>
      <ThemeScript />
      {children}
    </PageTransition>
  )
}
