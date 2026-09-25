import type React from 'react'
import { Suspense } from 'react'
import { redirect } from '../../../../../src/redirect'

// A redirect decided inside a boundary, after the shell: the page's answer,
// arriving as the row's error. Nothing for the server to print - once per
// boundary, or at all.
async function Elsewhere(): Promise<React.ReactElement> {
  await new Promise((r) => setTimeout(r, 5))
  redirect('/agent-account')
}

export default function RedirectsInBoundaryPage() {
  return (
    <>
      <h1>On the way somewhere else</h1>
      <Suspense fallback={<p>one…</p>}>
        <Elsewhere />
      </Suspense>
      <Suspense fallback={<p>two…</p>}>
        <Elsewhere />
      </Suspense>
    </>
  )
}
