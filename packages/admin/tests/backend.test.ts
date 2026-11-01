import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { ActionValidationError } from '@rsc-kit/core/action'
import { saveRecord } from '../src/actions'
import { definePanel } from '../src/panel'
import { defineResource } from '../src/resource'
import { memorySource } from '../src/memory'

type Row = { id: number; email: string }
const form = z.object({ email: z.string().min(1) })

/**
 * A source whose backend has a rule the schema does not: Laravel's
 * unique:users,email, answered as 422 through rpc(), which the host call
 * throws as ActionValidationError.
 */
const users = (failure: Error) => {
  const memory = memorySource<Row, z.infer<typeof form>>([{ id: 1, email: 'a@x.test' }], 'id', (id, values) => ({ id, ...values }))

  return defineResource<Row>()({
    name: 'users',
    key: 'id',
    title: 'email',
    source: { ...memory, create: async () => Promise.reject(failure), update: async () => Promise.reject(failure) },
    table: (col) => [col.text('email')],
    form,
  })
}

const submit = (email: string) => {
  const data = new FormData()

  data.set('email', email)

  return data
}

describe('a backend that refuses a save', () => {
  test('leaves the save as the schema\'s refusal does, so its fields reach the form', async () => {
    definePanel({ path: '/b1', resources: [users(new ActionValidationError({ email: ['The email has already been taken.'] }))] })

    const schema = await saveRecord('/b1', 'users', null, submit('')).catch((error: unknown) => error)

    for (const id of [null, '1']) {
      const backend = await saveRecord('/b1', 'users', id, submit('a@x.test')).catch((error: unknown) => error)

      // The same error the schema throws, which the action wrapper answers
      // as { validationErrors } - the shape the form reads.
      expect(backend).toBeInstanceOf(ActionValidationError)
      expect((backend as Error).constructor).toBe((schema as Error).constructor)
      expect((backend as ActionValidationError).errors).toEqual({ email: ['The email has already been taken.'] })
    }
  })

  test('any other failure is still a failure', async () => {
    definePanel({ path: '/b2', resources: [users(new Error('backend down'))] })

    await expect(saveRecord('/b2', 'users', null, submit('b@x.test'))).rejects.toThrow('backend down')
  })
})
