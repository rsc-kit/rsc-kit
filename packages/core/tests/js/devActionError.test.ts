import { describe, expect, test } from 'bun:test'
import { devActionError, devActionErrorResponse, isActionCall } from '../../src/devActionError'
import { overlayError } from '../../src/js/devErrorOverlay'
import { httpHostCalls } from '../../src/hostCalls'
import { backendTraceProblem } from '../../src/conformance'

// A host call the backend failed, through the real client: Laravel's reply
// with app.debug on, the shape Go sends with Debug.
async function failedInLaravel(): Promise<unknown> {
  const call = httpHostCalls({
    endpoint: 'http://app.test/__rsc/host-call',
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
              'vendor/laravel/framework/src/Illuminate/Database/Eloquent/Model.php:807 Illuminate\\Database\\Eloquent\\Model->fill()',
              'app/Rsc/Actions/Notification.php:20 Illuminate\\Database\\Eloquent\\Model::__callStatic()',
              'vendor/rsc-kit/laravel/src/CallableRegistry.php:150 App\\Rsc\\Actions\\Notification->__invoke()',
            ],
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )) as never,
  })

  return await call('Notification', { email: 'a@b.c' }).then(
    () => null,
    (error) => error,
  )
}

describe('a failed action, described for the browser in development', () => {
  test("the backend's type, message and frames come apart from the renderer's stack", async () => {
    const described = devActionError(await failedInLaravel())

    expect(described.message).toContain('Host call "Notification" failed')
    expect(described.stack).not.toContain('Caused in the backend')
    expect(described.backend?.type).toBe('Illuminate\\Database\\Eloquent\\MassAssignmentException')
    expect(described.backend?.frames).toHaveLength(4)
  })

  test("the overlay leads with the backend's exception and names the app's own file", async () => {
    const shown = overlayError(devActionError(await failedInLaravel()))

    expect(shown.message).toBe(
      'Illuminate\\Database\\Eloquent\\MassAssignmentException: Add [email] to fillable property to allow mass assignment on [App\\Models\\NotificationRequest].',
    )
    expect(shown.id).toBe('app/Rsc/Actions/Notification.php:20')
    // The framework's frames are counted, not listed.
    expect(shown.stack).toContain('    at app/Rsc/Actions/Notification.php:20')
    expect(shown.stack).not.toContain('vendor/laravel')
    expect(shown.stack).toContain('… 3 more in dependencies')
    expect(shown.stack).toContain('In the renderer:')
  })

  test('a failure in the renderer itself has no backend part', () => {
    const described = devActionError(new TypeError('x is undefined'))

    expect(described.backend).toBeUndefined()
    expect(overlayError(described)).toMatchObject({ message: 'x is undefined', plugin: 'rsc-kit' })
  })

  test('is marked, so a proxy\'s own 500 is not read as one; and only for an action', async () => {
    const response = devActionErrorResponse(new Error('boom'))

    expect(response.status).toBe(500)
    expect(response.headers.get('X-RSC-Dev-Error')).toBe('1')
    expect(((await response.json()) as { message: string }).message).toBe('boom')

    expect(isActionCall(new Request('http://a.test/_rsc/action', { method: 'POST', headers: { 'X-RSC-Action': 'abc' } }))).toBe(true)
    expect(isActionCall(new Request('http://a.test/page'))).toBe(false)
  })
})

describe('conformance, with --debug', () => {
  test("passes a failure carrying the backend's type, message and frames", async () => {
    expect(backendTraceProblem(await failedInLaravel())).toBeNull()
  })

  test('fails one without, and says where debug is turned on', () => {
    expect(backendTraceProblem(new Error('boom'))).toContain('APP_DEBUG=true')
  })
})
