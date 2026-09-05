/**
 * Server actions with a schema and middleware.
 *
 * The behaviour worth pinning is that failures are RETURNED. React serialises
 * a rejected server action opaquely — production strips the message and keeps
 * only a digest — so a thrown validation error reaches the browser as "an
 * error occurred" with the fields it named gone.
 */

import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { createActionClient, fieldErrors } from '../../src/action'

const action = createActionClient({ onError: () => 'Something went wrong.' })

describe('input', () => {
  test('reaches the handler parsed, not raw', async () => {
    const run = action
      .input(z.object({ count: z.coerce.number() }))
      .handler(async ({ input }) => input.count + 1)

    expect(await run({ count: '41' })).toEqual({ data: 42 })
  })

  test('a rejected input never runs the handler', async () => {
    let ran = false
    const run = action.input(z.object({ title: z.string().min(3, 'Too short') })).handler(async () => {
      ran = true
    })

    expect(await run({ title: 'x' })).toEqual({ validationErrors: { title: ['Too short'] } })
    expect(ran).toBe(false)
  })

  test('FormData is accepted, because that is what a form sends', async () => {
    const body = new FormData()

    body.set('title', 'from a form')

    const run = action.input(z.object({ title: z.string() })).handler(async ({ input }) => input.title)

    expect(await run(body)).toEqual({ data: 'from a form' })
  })

  test('a repeated field stays a list', async () => {
    // A multi-select collapsed to its last entry is a silent data loss.
    const body = new FormData()

    body.append('tags', 'a')
    body.append('tags', 'b')

    const run = action
      .input(z.object({ tags: z.array(z.string()) }))
      .handler(async ({ input }) => input.tags)

    expect(await run(body)).toEqual({ data: ['a', 'b'] })
  })
})

describe('files', () => {
  test('a File arrives as a File, not as a name', async () => {
    // FormData carries them natively and React's Flight format serialises
    // them, so nothing has to be encoded on the way in or decoded on the way
    // out — the action receives what the input held.
    const body = new FormData()

    body.set('avatar', new File(['hello'], 'me.png', { type: 'image/png' }))

    const run = action
      .input(z.object({ avatar: z.instanceof(File) }))
      .handler(async ({ input }) => ({
        name: input.avatar.name,
        type: input.avatar.type,
        text: await input.avatar.text(),
      }))

    expect(await run(body)).toEqual({
      data: { name: 'me.png', type: 'image/png', text: 'hello' },
    })
  })

  test('a multiple input keeps every file', async () => {
    // The same reason a repeated text field stays a list: collapsing to the
    // last entry loses files the user chose, with nothing to say so.
    const body = new FormData()

    body.append('gallery', new File(['a'], 'one.jpg'))
    body.append('gallery', new File(['b'], 'two.jpg'))

    const run = action
      .input(z.object({ gallery: z.array(z.instanceof(File)) }))
      .handler(async ({ input }) => input.gallery.map((f) => f.name))

    expect(await run(body)).toEqual({ data: ['one.jpg', 'two.jpg'] })
  })

  test('a missing file is a field error like any other', async () => {
    const body = new FormData()

    body.set('title', 'No file attached')

    const run = action
      .input(z.object({ avatar: z.instanceof(File, { message: 'Choose a file' }) }))
      .handler(async () => 'saved')

    expect(await run(body)).toEqual({ validationErrors: { avatar: ['Choose a file'] } })
  })
})

describe('middleware', () => {
  test('what it adds is there for the handler', async () => {
    const run = action
      .use(async ({ next }) => next({ ctx: { user: { id: 7 } } }))
      .handler(async ({ ctx }) => ctx.user.id)

    expect(await run()).toEqual({ data: 7 })
  })

  test('and accumulates across several, each seeing the last', async () => {
    const run = action
      .use(async ({ next }) => next({ ctx: { user: { id: 7 } } }))
      .use(async ({ ctx, next }) => next({ ctx: { audit: `user:${ctx.user.id}` } }))
      .handler(async ({ ctx }) => ctx.audit)

    expect(await run()).toEqual({ data: 'user:7' })
  })

  test('one that throws stops the action', async () => {
    let ran = false
    const run = action
      .use(async () => {
        throw new Error('not signed in')
      })
      .handler(async () => {
        ran = true
      })

    expect(await run()).toEqual({ serverError: 'Something went wrong.' })
    expect(ran).toBe(false)
  })

  test('one that neither continues nor throws is a mistake, said out loud', async () => {
    // Silence is not refusal. A middleware that forgot to call next() would
    // otherwise look exactly like a check that passed, and this is the one
    // error not reduced to a message for the browser — it is for whoever
    // wrote the middleware.
    let ran = false
    const run = action
      .use(async () => undefined as never)
      .handler(async () => {
        ran = true
      })

    expect(run()).rejects.toThrow(/without calling next/)
    expect(ran).toBe(false)
  })

  test('runs outermost first, so a step can wrap the ones after it', async () => {
    const order: string[] = []
    const run = action
      .use(async ({ next }) => {
        order.push('first in')

        // Returned, not discarded: what next() gives back carries the value
        // from everything inside it, so a wrapping step has to pass it on.
        const inner = await next()

        order.push('first out')

        return inner
      })
      .use(async ({ next }) => {
        order.push('second')

        return next()
      })
      .handler(async () => {
        order.push('handler')
      })

    await run()

    expect(order).toEqual(['first in', 'second', 'handler', 'first out'])
  })
})

describe('failing from inside the handler', () => {
  test('fieldErrors names the fields, for what a schema cannot know', async () => {
    const run = action
      .input(z.object({ name: z.string() }))
      .handler(async ({ input }) => {
        if (input.name === 'taken') fieldErrors({ name: 'Already taken' })

        return 'saved'
      })

    expect(await run({ name: 'taken' })).toEqual({ validationErrors: { name: ['Already taken'] } })
    expect(await run({ name: 'free' })).toEqual({ data: 'saved' })
  })

  test('anything else is reduced to a message', async () => {
    // The message of an unexpected error may name a query, a path, a host.
    const run = action.handler(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.4:5432')
    })

    const result = await run()

    expect(result.serverError).toBe('Something went wrong.')
    expect(JSON.stringify(result)).not.toContain('10.0.0.4')
  })

  test('and onError chooses what is safe to say', async () => {
    class Expected extends Error {}

    const client = createActionClient({
      onError: (e) => (e instanceof Expected ? e.message : 'Something went wrong.'),
    })

    expect(await client.handler(async () => {
      throw new Expected('Plan limit reached')
    })()).toEqual({ serverError: 'Plan limit reached' })
  })
})
