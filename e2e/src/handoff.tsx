import { redirect } from '@rsc-kit/core/redirect'
import type { Route } from '@rsc-kit/core/routes'

/** hpd-api's /gitlab/connect: the backend's, named in backendPaths, bouncing to another origin. */
export const BACKEND = '/gitlab/connect'

/** Where the backend sends on, and what a page may send someone to directly. */
export const ELSEWHERE = 'http://127.0.0.1:4610/oauth/authorize?state=1'

// Inside a boundary the redirect arrives after the shell, as an error digest,
// and the client performs it - on a page that was already shown and pushed.
// Typed `Route`, so what the build wrote for backendPaths is what is checked here:
// no cast on either destination.
export async function Leave({ to }: { to: Route }) {
  await new Promise((resolve) => setTimeout(resolve, 50))

  return redirect(to)
}
