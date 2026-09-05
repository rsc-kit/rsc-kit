import { redirect } from '@rsc-router/core/redirect'

// Runs before anything at or below app/guarded renders — a full load, a
// partial navigation, a revalidation, an interception. Nothing in the request
// can decline it, because middleware are not part of what a navigation narrows.
export default async function guard() {
  const allowed = false

  if (!allowed) redirect('/orders')
}
