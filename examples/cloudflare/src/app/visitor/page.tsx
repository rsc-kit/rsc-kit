import { Suspense } from 'react'
import { cookies, headers } from '@rsc-kit/core/request'
import type { Metadata } from '@rsc-kit/core/metadata'
import { countVisit } from './actions'

export const metadata: Metadata = { title: 'Visitor' }

// The part that depends on who is asking. It reads the request, so it cannot
// be stored: the build stores the page around it, with this as a hole the
// Worker fills per request.
async function AboutYou() {
  const country = (await headers()).get('cf-ipcountry') ?? 'somewhere'
  const visits = Number((await cookies()).get('visits')?.value ?? 0)

  return (
    <>
      <p className="mt-4">
        You are in <strong>{country}</strong>, and have counted <strong>{visits}</strong>{' '}
        {visits === 1 ? 'visit' : 'visits'}.
      </p>
      <form action={countVisit} className="mt-4">
        <button className="rounded bg-slate-900 px-3 py-1 text-white">Count this visit</button>
      </form>
    </>
  )
}

// The page itself paints at once: its heading is in the stored shell, and only
// the slot below waits for the request.
export default function VisitorPage() {
  return (
    <>
      <h1 className="text-3xl font-bold">About you</h1>
      <p className="mt-4 text-slate-600">
        Cloudflare tells the Worker your country in <code>cf-ipcountry</code>. The count is a
        cookie a server action sets.
      </p>
      <Suspense fallback={<p className="mt-4 text-slate-400">You are in …</p>}>
        <AboutYou />
      </Suspense>
    </>
  )
}
