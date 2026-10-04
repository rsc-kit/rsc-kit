import { Suspense } from 'react'
import { connection } from '@rsc-kit/core/request'
import { RootPicker } from '../../components/RootPicker'

// The shell is stored; the form is a hole filled per request, so the server
// has the visitor's query there: the picker reading ?root= renders in the
// server's HTML, not after a flash in the browser.
async function Settings() {
  await connection()

  return <RootPicker />
}

export default function FiltersPage() {
  return (
    <main>
      <h1>Filters</h1>
      <Suspense fallback={<p id="settings-loading">loading…</p>}>
        <Settings />
      </Suspense>
    </main>
  )
}
