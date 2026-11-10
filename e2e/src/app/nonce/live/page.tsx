import { cookies } from '@rsc-kit/core/request'

// Reads the request, so it is rendered for each one, by nonce.
export default async function LiveNoncePage() {
  await cookies()

  return <h1 id="nonce-page">Live</h1>
}
