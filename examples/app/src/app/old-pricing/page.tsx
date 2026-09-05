import { redirect } from '@rsc-router/core/redirect'

// Inside a boundary: app/loading.tsx wraps every page, so this page's own
// render is behind Suspense and the shell has already gone out by the time
// this runs. The redirect travels in the payload rather than a status line.
export default async function OldPricing() {
  await new Promise((r) => setTimeout(r, 10))

  redirect('/orders')
}
