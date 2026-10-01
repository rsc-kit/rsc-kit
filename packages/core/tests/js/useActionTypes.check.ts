/**
 * useAction's types follow the action's: what execute takes, and what
 * onSuccess is handed. Checked by `bun run typecheck`.
 */
import { z } from 'zod'
import { createActionClient } from '../../src/action'
import { useAction } from '../../src/js/useAction'

const action = createActionClient()

const archive = action
  .input(z.object({ id: z.number() }))
  .handler(async ({ input }) => ({ archived: input.id }))

const ping = action.handler(async () => 'pong' as const)

export function Check() {
  const { execute, executeAsync } = useAction(archive, {
    optimistic: (input) => {
      if (!(input instanceof FormData)) {
        const id: number = input.id
        void id
      }
    },
    onSuccess: (data) => {
      const n: number = data.archived
      void n
    },
  })

  execute({ id: 1 })
  // @ts-expect-error id is a number
  execute({ id: 'one' })
  // @ts-expect-error the schema needs input
  execute()
  void executeAsync({ id: 2 }).then((r) => r.data?.archived)

  const bare = useAction(ping, { onSuccess: (data) => { const p: 'pong' = data; void p } })
  bare.execute()

  return null
}
