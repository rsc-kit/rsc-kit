import { Suspense } from 'react'
import { cookies, headers } from '@rsc-kit/core/request'

export const metadata = { title: 'Locale' }

async function Detected() {
  const chosen = (await cookies()).get('locale') ?? (await headers()).get('accept-language')?.slice(0, 2)

  return (
    <>
      <h1 id="locale">{chosen}</h1>
      <p>from {(await cookies()).has('locale') ? 'a cookie' : 'accept-language'}</p>
    </>
  )
}

// The boundary is here, where the waiting is — not inherited from the root
// loading.tsx, which would make every page in the app show the same fallback
// while this one's header read resolves.
export default function LocalePage() {
  return (
    <Suspense fallback={<p className="muted">Detecting your language…</p>}>
      <Detected />
    </Suspense>
  )
}
