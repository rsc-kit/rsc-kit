/**
 * <Form>'s formRefusal, typed from its action - checked by the typechecker,
 * not at runtime. `bun run typecheck` runs it.
 */
import { z } from 'zod'
import { createActionClient } from '../../src/action'
import Form from '../../src/js/Form'

const action = createActionClient()

const deleteProject = action
  .input(z.object({ id: z.number() }))
  .refusal(z.object({ blockers: z.array(z.object({ id: z.number(), href: z.string() })) }))
  .handler(async () => 'gone')

const plain = action.handler(async () => 'ok')

export const typed = (
  <Form action={deleteProject}>
    {({ formRefusal }) => {
      // From the action's .refusal(schema): no cast.
      const links: { id: number; href: string }[] | undefined = formRefusal?.blockers
      // @ts-expect-error the declared shape has no `reason`
      const wrong = formRefusal?.reason

      return String(links?.length ?? 0) + String(wrong)
    }}
  </Form>
)

export const undeclared = (
  <Form action={plain}>
    {({ formRefusal }) => {
      // No .refusal(schema): there is never any refusal data.
      const none: undefined = formRefusal

      return String(none)
    }}
  </Form>
)

export const url = (
  <Form action={'/search' as never}>
    {({ formRefusal }) => {
      // A url carries nothing typed: unknown, as before.
      const anything: unknown = formRefusal

      return String(anything)
    }}
  </Form>
)
