'use server'

import { createActionClient } from '@rsc-kit/core/action'
import { ServerAuthenticationError } from '@rsc-kit/core/errors'

// Every action and query in this app is built from one of these clients, so
// the check runs before the body and cannot be forgotten:
//
//   export const createPost = authedClient.input(schema).handler(async ({ input, ctx }) => …)
//   export const getPosts   = publicClient.query(async () => …)
//
// An action is a public endpoint - anyone can call it, with any arguments -
// so the check belongs here, never in the component that shows the button.

/** Anyone may call it: public reads, a contact form. */
export const publicClient = createActionClient()

/** Only someone signed in; ctx.user is theirs inside the action. */
export const authedClient = publicClient.use(async ({ next }) => {
  const user = await currentUser()

  if (!user) throw new ServerAuthenticationError()

  return next({ ctx: { user } })
})

/**
 * Who is calling - connect this to your session: read its cookie with
 * cookies() from '@rsc-kit/core/request', and look the user up. Until then
 * nobody is signed in, and authedClient refuses every call.
 */
async function currentUser(): Promise<{ id: string } | null> {
  return null
}
