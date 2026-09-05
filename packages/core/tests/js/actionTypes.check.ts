/**
 * The types, checked by the typechecker rather than at runtime.
 *
 * Not a .test.ts: there is nothing to assert while running. What it pins is
 * that `input` follows from the schema and `ctx` from every middleware that
 * ran — the whole point of building an action this way — and that neither
 * silently degrades to `any`, which is how a typed API stops being one without
 * a single test failing.
 *
 * `bun run typecheck` is what runs it.
 */
import { z } from 'zod'
import { createActionClient } from '../../src/action'

const action = createActionClient()

export const create = action
  .use(async ({ next }) => next({ ctx: { user: { id: 7, name: 'Ada' } } }))
  .use(async ({ ctx, next }) => next({ ctx: { audit: ctx.user.name } }))
  .input(z.object({ title: z.string(), count: z.number() }))
  .handler(async ({ input, ctx }) => {
    const t: string = input.title
    const c: number = input.count
    const n: string = ctx.user.name
    const a: string = ctx.audit
    // @ts-expect-error a string is not a number — the schema said so
    const wrong: number = input.title
    // @ts-expect-error no middleware added `missing`
    const absent = ctx.missing

    return { t, c, n, a, wrong, absent }
  })

async function check() {
  const r = await create({ title: 'x', count: 1 })
  const data: { t: string } | undefined = r.data
  const errs: Record<string, string[]> | undefined = r.validationErrors
  return [data, errs]
}
void check
