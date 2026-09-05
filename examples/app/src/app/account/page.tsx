import { lookupCount } from '../../session'

export const metadata = { title: 'Account' }

// The same bytes for everyone allowed to see them — so this page is frozen at
// build time, and the guard beside it decides per request who gets the file.
// The number is how many session lookups this process has done in total.
export default function AccountPage() {
  return (
    <>
      <h1>Your account</h1>
      <p>
        Frozen at build time. Served only after the guard passes.{' '}
        <span id="lookups">{lookupCount()}</span>
      </p>
    </>
  )
}
