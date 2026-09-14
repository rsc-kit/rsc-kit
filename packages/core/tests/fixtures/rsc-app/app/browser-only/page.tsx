import { Suspense } from 'react'
import { SavedDraft } from '../../SavedDraft'

export const metadata = { title: 'Browser Only' }

export default function BrowserOnlyPage() {
  return (
    <main>
      <h1>Saved draft</h1>
      <Suspense fallback={<p id="draft-fallback">Loading draft…</p>}>
        <SavedDraft />
      </Suspense>
    </main>
  )
}
