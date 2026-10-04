'use server'

import { cookies } from '@rsc-kit/core/request'
import { revalidate } from '@rsc-kit/core/revalidate'
import { redirect } from '@rsc-kit/core/redirect'

// The demo's add to cart: a cookie, and the whole document rendered again.
export async function addToCart(_: string | null, form: FormData): Promise<string> {
  const jar = await cookies()
  const count = Number(jar.get('cart')?.value ?? 0) + 1

  jar.set('cart', String(count), { path: '/' })
  revalidate('all')

  return `Added ${String(form.get('product'))}`
}

// Sign in, and go back to the page you came from: a cookie the page reads,
// and a redirect to a page the router may still be holding.
export async function signInAndReturn(form: FormData): Promise<void> {
  ;(await cookies()).set('signed-in', 'yes', { path: '/' })
  redirect(String(form.get('to')) as never)
}

// Rename a project, and ask for the page it was called from again - which is
// at the old address, and now redirects from inside its boundary.
export async function renameProject(form: FormData): Promise<void> {
  ;(await cookies()).set('project', String(form.get('to')), { path: '/' })
  revalidate('page')
}
