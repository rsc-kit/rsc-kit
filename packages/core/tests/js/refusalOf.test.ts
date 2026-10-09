/**
 * Telling a refused call from the result asked for.
 *
 * A stub the build writes for a backend action is a plain function, and when the
 * backend turns the call down the server answers with the message marked - React
 * strips the message of anything it throws - and the browser rejects with it.
 * An action built with createActionClient() returns its failures as its result
 * and is never rejected for.
 */

import { describe, expect, test } from 'bun:test'
import { ActionRefusedError, ServerValidationError, refusalOf } from '../../src/js/errors'

describe('refusalOf', () => {
  test('a marked answer is a refusal, with its message and status', () => {
    expect(refusalOf({ serverError: 'The queue is busy', __rscRefused: 503 })).toEqual({ message: 'The queue is busy', status: 503 })
  })

  test('a createActionClient failure is a result, not a refusal', () => {
    expect(refusalOf({ serverError: 'Still in use', refusal: { blockers: [] } })).toBeNull()
    expect(refusalOf({ validationErrors: { title: ['too short'] } })).toBeNull()
  })

  test('an input refused field by field is one too, with its fields', () => {
    expect(refusalOf({ validationErrors: { name: ['Required'], '': ['Check the form'] }, __rscRefused: 422 })).toEqual({
      message: 'Validation failed',
      status: 422,
      errors: { name: ['Required'], '': ['Check the form'] },
    })
  })

  test('nothing else is', () => {
    for (const value of [undefined, null, 'ok', 3, [], {}, { data: 1 }, { __rscRefused: 'x', serverError: 'y' }, { __rscRefused: 409 }]) {
      expect(refusalOf(value)).toBeNull()
    }
  })
})

describe('ActionRefusedError', () => {
  test('carries the backend\'s message and status, and is recognised from another copy of the module', () => {
    const error = new ActionRefusedError('Slow down', 429)

    expect(error.message).toBe('Slow down')
    expect(error.status).toBe(429)
    expect(error instanceof ActionRefusedError).toBe(true)
    expect(new ActionRefusedError('x').status).toBe(409)
  })
})

describe('ServerValidationError', () => {
  test('splits the fields from the messages about the input as a whole', () => {
    const error = new ServerValidationError('Validation failed', { name: ['Required'], 'address.city': ['Too short'], '': ['Check the form'] })

    expect(error.fieldErrors).toEqual({ name: ['Required'], 'address.city': ['Too short'] })
    expect(error.formErrors).toEqual(['Check the form'])
    expect(error.errors['']).toEqual(['Check the form'])
    expect(new ServerValidationError('x', { name: ['y'] }).formErrors).toEqual([])
  })
})
