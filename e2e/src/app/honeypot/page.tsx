import { Suspense } from 'react'
import { Honeypot } from '@rsc-kit/core/honeypot'
import { cookies } from '@rsc-kit/core/request'
import { subscribe } from '../../actions'

async function Saw() {
  const saw = (await cookies()).get('subscribed')?.value

  return <p id="saw">{saw === undefined ? 'nothing yet' : `saw: ${saw}`}</p>
}

export default function HoneypotPage() {
  return (
    <main>
      <h1>Honeypot</h1>
      <form action={subscribe}>
        <input name="email" defaultValue="ann@example.com" />
        <Honeypot />
        <button type="submit" id="subscribe">subscribe</button>
      </form>
      <Suspense fallback={<p>…</p>}>
        <Saw />
      </Suspense>
    </main>
  )
}
