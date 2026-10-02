// The app and the server are bundled apart, so the class an app imports and
// the one the rpc() client throws can be two copies of this module. A server
// component checking `instanceof ServerAuthenticationError` never matched.

import { describe, expect, test } from 'bun:test'
import * as mine from '../../src/js/errors'

describe('an error thrown by another copy of the module', () => {
  test('is an instance of this copy\'s class, and of no other', async () => {
    // A second copy, as a separately bundled module would be.
    const other = (await import('../../src/js/errors.ts?another-copy')) as typeof mine

    expect(other.ServerAuthenticationError).not.toBe(mine.ServerAuthenticationError)

    const thrown = new other.ServerAuthenticationError()

    expect(thrown instanceof mine.ServerAuthenticationError).toBe(true)
    expect(thrown instanceof mine.ServerAuthorizationError).toBe(false)
    expect(new other.ServerAuthorizationError() instanceof mine.ServerAuthorizationError).toBe(true)
  })

  test('a plain error is none of them, and they are still Errors', () => {
    expect(new Error('Unauthenticated.') instanceof mine.ServerAuthenticationError).toBe(false)
    expect(new mine.ServerValidationError('x', {}) instanceof Error).toBe(true)
  })
})
