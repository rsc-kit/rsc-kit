// Checking a form's fields before it is submitted - Laravel's Precognition,
// for any backend. What is pinned here is the safety of it: a check runs an
// action's guards and validation and never its body, and an action that
// cannot be checked that way is never run at all.

import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { createActionClient, fieldErrors } from '../../src/action'
import { httpHostCalls } from '../../src/hostCalls'
import { CHECK_FIELD, checkOf, checkOnly } from '../../src/precognition'
import { fieldMatches } from '../../src/js/checkField'
import { withRequest } from '../../src/request'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('precognition.test.ts')

const FORMS = Symbol.for('rsc-kit.host-forms')
const globals = globalThis as Record<symbol, unknown>

afterEach(() => {
  delete globals[FORMS]
})

const form = (entries: Record<string, string>, check?: string[] | string) => {
  const data = new FormData()

  for (const [k, v] of Object.entries(entries)) data.append(k, v)
  if (check !== undefined) data.set(CHECK_FIELD, typeof check === 'string' ? check : JSON.stringify(check))

  return data
}

const inRequest = <T>(run: () => Promise<T>) => withRequest({ url: 'http://app.test/_rsc/action', headers: {} }, run)

describe('checkOf', () => {
  test('is null for an ordinary call', () => {
    expect(checkOf([form({ name: 'Ada' })])).toBeNull()
    expect(checkOf(['not a form'])).toBeNull()
  })

  test('reads the fields, and takes the mark out of the form', () => {
    const data = form({ name: 'Ada' }, ['name', 'email'])

    expect(checkOf([data])).toEqual(['name', 'email'])
    expect(data.has(CHECK_FIELD)).toBe(false)
    expect(data.get('name')).toBe('Ada')
  })

  // What the encoder sends for a FormData it does not take for one.
  test('reads the mark from a form that arrived as an object', () => {
    const fields: Record<string, string> = { name: 'Ada', [CHECK_FIELD]: '["name"]' }

    expect(checkOf([fields])).toEqual(['name'])
    expect(fields).toEqual({ name: 'Ada' })
  })

  test('an empty list is every field', () => {
    expect(checkOf([form({}, [])])).toEqual([])
  })

  // Whatever sent it meant a check. Read as no mark, it would be a submit.
  test('a mark it cannot read is still a check', () => {
    expect(checkOf([form({}, 'not json')])).toBe('malformed')
    expect(checkOf([form({}, '{"a":1}')])).toBe('malformed')
  })
})

describe('fieldMatches', () => {
  test("Laravel's rule: exact, or * for one segment", () => {
    expect(fieldMatches('email', ['email'])).toBe(true)
    expect(fieldMatches('email', ['name'])).toBe(false)
    expect(fieldMatches('items.0.name', ['items.*.name'])).toBe(true)
    expect(fieldMatches('items.0.price', ['items.*.name'])).toBe(false)
    expect(fieldMatches('items.0.tags.1', ['items.*.name'])).toBe(false)
    expect(fieldMatches('anything', [])).toBe(true)
  })
})

describe('a createActionClient action', () => {
  const schema = z.object({ name: z.string().min(2, 'too short'), email: z.string().email('not an email') })

  test('runs its validation and never its body', async () => {
    let ran = false
    const action = createActionClient()
      .input(schema)
      .handler(async () => {
        ran = true
      })

    const checked = await inRequest(() => checkOnly(action, [form({ name: 'A', email: 'nope' })], ['name']))

    expect(checked).toEqual({ errors: { name: ['too short'] } })
    expect(ran).toBe(false)
  })

  test('answers nothing when the fields pass, whatever the others hold', async () => {
    let ran = false
    const action = createActionClient()
      .input(schema)
      .handler(async () => {
        ran = true
      })

    expect(await inRequest(() => checkOnly(action, [form({ name: 'Ada', email: 'nope' })], ['name']))).toEqual({})
    expect(ran).toBe(false)
  })

  test('runs its middleware, which is where the guards are', async () => {
    const action = createActionClient()
      .use(async () => {
        throw fieldErrors({ name: ['That name is reserved.'] })
      })
      .input(schema)
      .handler(async () => {})

    expect(await inRequest(() => checkOnly(action, [form({ name: 'root', email: 'a@b.co' })], ['name']))).toEqual({
      errors: { name: ['That name is reserved.'] },
    })
  })

  test('without an input schema it has nothing to check', async () => {
    const action = createActionClient().handler(async () => {})

    expect(await inRequest(() => checkOnly(action, [form({})], ['name']))).toEqual({ unsupported: true })
  })
})

describe('an action of the app own', () => {
  // A plain "use server" function cannot be told to stop before its body.
  test('is never run', async () => {
    let ran = false
    const action = async () => {
      ran = true
    }

    expect(await inRequest(() => checkOnly(action, [form({})], ['name']))).toEqual({ unsupported: true })
    expect(ran).toBe(false)
  })
})

describe('a backend stub', () => {
  function backend(reply: unknown, status = 200) {
    const bodies: any[] = []
    const call = httpHostCalls({
      endpoint: 'http://127.0.0.1:9999/__rsc/host-call',
      secret: 's',
      fetch: (async (_: unknown, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)))

        return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } })
      }) as unknown as typeof fetch,
    })

    // What the build writes: the stub calls its one function and nothing else.
    const stub = async (data: FormData) => await call('Contact.send', Object.fromEntries(data))

    return { bodies, stub }
  }

  test('sends its one call with validate, alone, and reads a 422 as the errors', async () => {
    const { bodies, stub } = backend({ validationErrors: { email: ['Already subscribed.'], name: ['Required.'] } }, 422)

    globals[FORMS] = { actions: new Map([[stub, 'Contact.send']]), validates: new Set(['Contact.send']) }

    const checked = await inRequest(() => checkOnly(stub, [form({ email: 'a@b.co' })], ['email']))

    expect(bodies).toEqual([{ function: 'Contact.send', args: [{ email: 'a@b.co' }], validate: ['email'] }])
    // Kept to what was asked, whatever the backend answered for.
    expect(checked).toEqual({ errors: { email: ['Already subscribed.'] } })
  })

  test('a null result is a pass', async () => {
    const { stub } = backend({ result: null })

    globals[FORMS] = { actions: new Map([[stub, 'Contact.send']]), validates: new Set(['Contact.send']) }

    expect(await inRequest(() => checkOnly(stub, [form({ email: 'a@b.co' })], ['email']))).toEqual({})
  })

  // A backend that has never heard of `validate` would run the call.
  test('is never sent a check its backend does not list', async () => {
    const { bodies, stub } = backend({ result: null })

    globals[FORMS] = { actions: new Map([[stub, 'Contact.send']]), validates: new Set() }

    expect(await inRequest(() => checkOnly(stub, [form({})], ['email']))).toEqual({ unsupported: true })
    expect(bodies).toEqual([])
  })

  test('a refusal is no verdict on the fields', async () => {
    const { stub } = backend({ error: 'This action is unauthorized.', unauthorized: true }, 403)

    globals[FORMS] = { actions: new Map([[stub, 'Contact.send']]), validates: new Set(['Contact.send']) }

    expect(await inRequest(() => checkOnly(stub, [form({})], ['email']))).toEqual({})
  })

  test('the mark is gone when the check is over', async () => {
    const { bodies, stub } = backend({ result: null })

    globals[FORMS] = { actions: new Map([[stub, 'Contact.send']]), validates: new Set(['Contact.send']) }

    await inRequest(async () => {
      await checkOnly(stub, [form({})], ['email'])
      await stub(form({ email: 'a@b.co' }))
    })

    expect(bodies[1]).toEqual({ function: 'Contact.send', args: [{ email: 'a@b.co' }] })
  })

  // Outside a request nothing can carry the mark to the call, and a call
  // that went out unmarked would run.
  test('is not checked with no request in scope', async () => {
    const { bodies, stub } = backend({ result: null })

    globals[FORMS] = { actions: new Map([[stub, 'Contact.send']]), validates: new Set(['Contact.send']) }

    expect(await checkOnly(stub, [form({})], ['email'])).toEqual({ unsupported: true })
    expect(bodies).toEqual([])
  })
})
