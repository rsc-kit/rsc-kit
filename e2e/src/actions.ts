'use server'

import { cookies } from '@rsc-kit/core/request'
import { revalidate } from '@rsc-kit/core/revalidate'
import { redirect } from '@rsc-kit/core/redirect'
import { fieldErrors, refuse } from '@rsc-kit/core/action'

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

// What a stub the build generated for a backend action does when the backend
// refuses it (Go's Refuse(503, ...), Laravel's abort(429, ...)): throws, from a
// plain "use server" function. The message was written for the person asking.
export async function busy(): Promise<void> {
  refuse('The queue is busy, try again in a minute', undefined, { status: 503 })
}

// What a stub for a backend action does when the backend refuses its INPUT
// (Laravel's ValidationException, a Go Invalid): throws, from a plain function.
export async function invalid(): Promise<void> {
  fieldErrors({ name: 'Name is required', '': 'Check the form' })
}
