/**
 * The fieldErrors a handler is given is typed to that handler's input.
 *
 * Checked by the typechecker rather than at runtime: what this pins is that a
 * field the schema does not have is a compile error, not an error the form
 * never shows. `bun run typecheck` runs it.
 */

import { createActionClient } from '../../src/action'

const schema = {
  '~standard': {
    version: 1 as const,
    vendor: 'check',
    validate: (value: unknown) => ({ value: value as { email: string; password: string } }),
    types: { input: {} as { email: string; password: string }, output: {} as { email: string; password: string } },
  },
}

const client = createActionClient()

export const signIn = client.input(schema).handler(async ({ input, fieldErrors }) => {
  // The fields the schema has: fine, as a string or a list.
  if (!input.email) fieldErrors({ email: 'Account not found' })
  if (!input.password) fieldErrors({ password: ['too short', 'no digits'] })

  // The whole submission: the empty key.
  fieldErrors({ '': 'Sign-in is disabled' })

  // @ts-expect-error a field the schema does not have
  fieldErrors({ emial: 'Account not found' })

  return { ok: true }
})

// A handler with no schema takes any field, because there is nothing to
// check against — which is what a schema-less action should get.
export const loose = client.handler(async ({ fieldErrors }) => {
  fieldErrors({ anything: 'goes' })

  return null
})

// The narrowing, pinned. A never-return through a destructured binding is not
// seen by TypeScript; a `return` of it is. This is the difference between a
// checked value being usable on the next line and not.
declare function find(): { id: number } | undefined

export const narrows = client.input(schema).handler(async ({ fieldErrors }) => {
  const user = find()

  if (!user) return fieldErrors({ email: 'Account not found' })

  return user.id
})
