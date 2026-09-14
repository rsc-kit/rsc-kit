'use client'

import { use, useState } from 'react'
import { browser } from 'react-dom'

// Renders in the browser and nowhere else. `use(browser())` stops the server
// render here and leaves the nearest Suspense fallback in the html, which is
// what makes a page holding one still freezable.
export function SavedDraft() {
  use(browser('the draft lives in localStorage'))

  const [draft] = useState(() => localStorage.getItem('draft') ?? '')

  return <p id="draft">{draft || 'empty'}</p>
}
