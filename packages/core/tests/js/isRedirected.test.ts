/**
 * Telling a redirect's answer from the result asked for.
 *
 * A call to a server action resolves with `{ redirected }` once the navigation
 * starts - rejecting reaches React and blanks the page - so what a caller got
 * back may not be what it asked for, and this is how it finds out.
 */

import { describe, expect, test } from 'bun:test'
import { isRedirected, type Redirected } from '../../src/js/errors'

describe('isRedirected', () => {
  test('is the answer to a redirect', () => {
    expect(isRedirected({ redirected: '/login' })).toBe(true)
  })

  test('is not a result, whatever its shape', () => {
    for (const result of [undefined, null, 'ok', 3, [], {}, { Password: 'x' }, { redirected: 1 }, { redirected: undefined }]) {
      expect(isRedirected(result)).toBe(false)
    }
  })

  test('narrows a stub result to the value, so reading it needs the check', () => {
    const result = { created: 'o-1' } as { created: string } | Redirected

    if (isRedirected(result)) return

    expect(result.created).toBe('o-1')
  })
})
