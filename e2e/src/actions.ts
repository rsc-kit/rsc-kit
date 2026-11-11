'use server'

import { cookies } from '@rsc-kit/core/request'
import { revalidate } from '@rsc-kit/core/revalidate'
import { redirect } from '@rsc-kit/core/redirect'
import { fieldErrors, refuse } from '@rsc-kit/core/action'
import { httpHostCalls } from '@rsc-kit/core/host-calls'

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

// A stub for a backend action whose record the platform could not find: the
// host call answers Refuse(404, ...), as Go does for a cron job that was deleted.
const platform = httpHostCalls({
  endpoint: 'http://platform.test/_rsc/call',
  secret: 's',
  fetch: (async () =>
    new Response(JSON.stringify({ error: 'That cron job no longer exists', refusalStatus: 404 }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })) as never,
})

export async function runCron(): Promise<void> {
  await platform('Crons.run', 7)
}

// A tab asks for the header it does not render: it is the layout's, and a
// section, so it is refreshed by name from any page beneath it.
export async function refreshDeskHeader(): Promise<void> {
  revalidate('header')
}

// A stub for a backend action that failed there - Laravel with app.debug on,
// Go with Debug: a 500 carrying the backend's own exception and frames. In
// development the page opens the overlay with them; in production it says
// nothing more than it did.
const failing = httpHostCalls({
  endpoint: 'http://backend.test/__rsc/host-call',
  secret: 's',
  fetch: (async () =>
    new Response(
      JSON.stringify({
        error: 'Add [email] to fillable property to allow mass assignment on [App\\Models\\NotificationRequest].',
        debug: {
          type: 'Illuminate\\Database\\Eloquent\\MassAssignmentException',
          message: 'Add [email] to fillable property to allow mass assignment on [App\\Models\\NotificationRequest].',
          trace: [
            'vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php:711',
            'app/Rsc/Actions/Notification.php:20 Illuminate\\Database\\Eloquent\\Model::__callStatic()',
          ],
        },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )) as never,
})

export async function notifyMe(): Promise<void> {
  await failing('Notification', { email: 'a@b.c' })
}
