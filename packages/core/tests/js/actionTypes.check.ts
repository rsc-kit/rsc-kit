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
import type { Redirected } from '../../src/js/errors'

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
  // Always an object: an action that redirected resolves with { redirected }
  // on the client, so every field reads undefined and nothing throws.
  const data: { t: string } | undefined = r.data
  const errs: Record<string, string[]> | undefined = r.validationErrors
  const went: string | undefined = r.redirected
  return [data, errs, went]
}
void check

// The caller's side follows the schema too: what the schema takes, or the
// FormData a form sends. Without a schema, anything.
async function callers() {
  await create({ title: 'x', count: 1 })
  await create(new FormData())
  // @ts-expect-error count is a number in the schema
  await create({ title: 'x', count: 'one' })
  // @ts-expect-error a schema that takes input needs some
  await create()

  const bare = action.handler(async () => 1)
  await bare()
  await bare({ anything: true })
}
void callers

// A refusal's data is typed from .refusal(schema): the handler's refuse()
// takes exactly that, and result.refusal is exactly that.
export const remove = action
  .input(z.object({ id: z.number() }))
  .refusal(z.object({ blockers: z.array(z.object({ id: z.number(), href: z.string() })) }))
  .handler(async ({ input, refuse }) => {
    if (input.id === 1) return refuse('Still in use', { blockers: [{ id: 2, href: '/orders/2' }] })
    // @ts-expect-error the declared shape has no `reason`
    if (input.id === 2) return refuse('Still in use', { reason: 'x' })
    // @ts-expect-error data is required once a shape is declared
    if (input.id === 3) return refuse('Still in use')

    return { removed: input.id }
  })

export const plain = action.handler(async ({ refuse }) => {
  // @ts-expect-error no .refusal(schema): a message, and no data to send
  refuse('No', { anything: true })

  return refuse('No')
})

async function checkRefusal() {
  const r = await remove({ id: 1 })
  const message: string | undefined = r.serverError
  const links: { id: number; href: string }[] | undefined = r.refusal?.blockers
  // @ts-expect-error result.refusal is the declared shape, not any
  const wrong: string | undefined = r.refusal?.reason

  const p = await plain()
  // No .refusal(schema): the result's refusal can only be undefined.
  const none: undefined = p.refusal

  return { message, links, wrong, none }
}

void checkRefusal

// A generated stub is typed `T | Redirected` for the browser. Returned from a
// handler it runs on the server, where a redirect is thrown, so `data` is `T`.
declare function stubText(): Promise<string | Redirected>
declare function stubNothing(): Promise<void | Redirected>
declare function stubShaped(): Promise<{ redirected: string; count: number } | Redirected>

export const fromStub = action.handler(async () => await stubText())
export const fromVoidStub = action.handler(async () => await stubNothing())
export const fromShapedStub = action.handler(async () => await stubShaped())

async function stubData() {
  const text: string | undefined = (await fromStub()).data
  // @ts-expect-error the redirect is the client's, set beside data and never inside it
  const leaked: Redirected | undefined = (await fromStub()).data
  const nothing: void | undefined = (await fromVoidStub()).data
  // Data that merely has a `redirected` field is data, and stays.
  const shaped: { redirected: string; count: number } | undefined = (await fromShapedStub()).data

  return { text, leaked, nothing, shaped }
}

export const readFromStub = action.query(async () => await stubText())

async function queryData() {
  const text: string = await readFromStub()

  return text
}
