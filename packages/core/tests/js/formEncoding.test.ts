// The one codec both sides use.
//
// What is pinned: an object survives the round trip through FormData - nested
// objects, lists of objects, lists of scalars, booleans, files - and the
// object an ACTION decodes is the object the FORM validated. The two used to
// differ: the form parsed nested names, the action did not, and a form with
// items[0].name passed in the browser and failed the same schema on the
// server. And the encoder turned any nested value into "[object Object]".
import { describe, expect, test } from 'bun:test'
import { buildFormData, decodeFormData, formDataToObject } from '../../src/js/formEncoding'
import { createActionClient } from '../../src/action'
import { z } from 'zod'

describe('buildFormData', () => {
  test('nests objects and lists of objects, repeats scalars, keeps files', () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })
    const fd = buildFormData({
      title: 'Tool',
      published: true,
      draft: false,
      tags: ['a', 'b'],
      fields: [
        { name: 'q', type: 'string' },
        { name: 'n', type: 'number' },
      ],
      auth: { kind: 'bearer', token: 't' },
      attachment: file,
      nothing: null,
      missing: undefined,
    })
    const entries = [...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `File(${(v as File).name})`])

    expect(entries).toEqual([
      ['title', 'Tool'],
      ['published', '1'],
      ['draft', '0'],
      ['tags[]', 'a'],
      ['tags[]', 'b'],
      ['fields[0][name]', 'q'],
      ['fields[0][type]', 'string'],
      ['fields[1][name]', 'n'],
      ['fields[1][type]', 'number'],
      ['auth[kind]', 'bearer'],
      ['auth[token]', 't'],
      ['attachment', 'File(a.txt)'],
    ])
    // Never this. It was, for every nested value.
    expect(entries.flat()).not.toContain('[object Object]')
  })
})

describe('the round trip', () => {
  test('what was built decodes to what was given', () => {
    const given = {
      title: 'Tool',
      tags: ['a', 'b'],
      fields: [{ name: 'q', type: 'string' }, { name: 'n', type: 'number' }],
      auth: { kind: 'bearer', token: 't' },
    }

    expect(formDataToObject(buildFormData(given))).toEqual(given)
  })

  test('an action decodes the same object the form validated', async () => {
    // The schema a tool form has: a list of fields and a union for auth.
    const schema = z.object({
      title: z.string().min(1),
      fields: z.array(z.object({ name: z.string(), type: z.enum(['string', 'number']) })),
      auth: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('none') }),
        z.object({ kind: z.literal('bearer'), token: z.string().min(1) }),
      ]),
    })
    const action = createActionClient().input(schema).handler(async ({ input }) => input)

    // The FormData a browser posts from a form with nested names - both
    // spellings, since both are in use.
    const fd = new FormData()
    fd.append('title', 'Tool')
    fd.append('fields[0].name', 'q')
    fd.append('fields[0].type', 'string')
    fd.append('fields[1][name]', 'n')
    fd.append('fields[1][type]', 'number')
    fd.append('auth[kind]', 'bearer')
    fd.append('auth[token]', 't')

    const answer = (await action(fd)) as { data?: unknown; validationErrors?: unknown }

    expect(answer.validationErrors).toBeUndefined()
    expect(answer.data).toEqual({
      title: 'Tool',
      fields: [{ name: 'q', type: 'string' }, { name: 'n', type: 'number' }],
      auth: { kind: 'bearer', token: 't' },
    })
  })

  test('a refusal names the nested field the way the form keys its errors', async () => {
    const schema = z.object({ fields: z.array(z.object({ name: z.string().min(1) })) })
    const action = createActionClient().input(schema).handler(async ({ input }) => input)
    const fd = new FormData()
    fd.append('fields[0][name]', '')

    const answer = (await action(fd)) as { validationErrors?: Record<string, string[]> }

    expect(Object.keys(answer.validationErrors ?? {})).toEqual(['fields.0.name'])
  })
})

// The schema knows what it means; the decoder reads the form that way. A
// schema written for the shape it wants - boolean, number - used to refuse a
// form that was perfectly filled in, because a form posts strings and an
// unchecked box posts nothing.
describe('coercing a form to its schema', () => {
  const settings = z.object({
    notify: z.boolean(),
    quiet: z.boolean().optional(),
    limit: z.number().int().min(1),
    ratio: z.number().optional(),
    tags: z.array(z.string()),
    policy: z.string().optional(),
    auth: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('none') }),
      z.object({ kind: z.literal('bearer'), token: z.string().min(1) }),
    ]),
    rules: z.array(z.object({ on: z.boolean(), max: z.number() })),
  })
  const action = createActionClient().input(settings).handler(async ({ input }) => input)

  test('what a browser posts validates as the types the schema means', async () => {
    const fd = new FormData()
    // notify: unchecked, so absent. quiet: checked.
    fd.append('quiet', 'on')
    fd.append('limit', '5')
    fd.append('ratio', '')          // an empty optional number is absent
    fd.append('tags[]', 'one')      // one tag is still a list
    fd.append('auth[kind]', 'bearer')
    fd.append('auth[token]', 't')
    fd.append('rules[0][on]', '1')
    fd.append('rules[0][max]', '3')
    fd.append('rules[1][max]', '4')  // rules[1].on unchecked

    const answer = (await action(fd)) as { data?: unknown; validationErrors?: unknown }

    expect(answer.validationErrors).toBeUndefined()
    expect(answer.data).toEqual({
      notify: false,
      quiet: true,
      limit: 5,
      tags: ['one'],
      auth: { kind: 'bearer', token: 't' },
      rules: [{ on: true, max: 3 }, { on: false, max: 4 }],
    })
  })

  test('what <Form transform> sends validates the same way', async () => {
    const fd = buildFormData({ notify: true, quiet: false, limit: 5, tags: ['a', 'b'], auth: { kind: 'none' }, rules: [] })
    const answer = (await action(fd)) as { data?: { notify: boolean; quiet?: boolean; limit: number } }

    expect(answer.data?.notify).toBe(true)
    expect(answer.data?.quiet).toBe(false)
    expect(answer.data?.limit).toBe(5)
    // An empty list posts nothing, and is an empty list.
    expect((answer.data as { rules?: unknown[] })?.rules).toEqual([])
  })

  test('a value the schema refuses is still refused, as itself', async () => {
    const fd = new FormData()
    fd.append('limit', 'many')
    fd.append('auth[kind]', 'bearer')

    const answer = (await action(fd)) as { validationErrors?: Record<string, string[]> }
    const fields = Object.keys(answer.validationErrors ?? {}).sort()

    // limit stayed the string "many" and failed as a number should; the
    // bearer branch was chosen by its discriminator and missed its token.
    // tags and rules were absent, which for a list is empty, not missing.
    expect(fields).toEqual(['auth.token', 'limit'])
  })

  test('without a schema that can describe itself, values are the strings posted', () => {
    const fd = new FormData()
    fd.append('on', 'on')
    fd.append('n', '5')

    expect(decodeFormData(fd)).toEqual({ on: 'on', n: '5' })
    expect(decodeFormData(fd, { '~standard': { validate: () => ({ value: {} }) } })).toEqual({ on: 'on', n: '5' })
  })
})

describe('a leaf the schema cannot describe', () => {
  test('costs that leaf, not the whole form', async () => {
    // z.date() has no JSON Schema. Refusing the whole schema over it turned
    // coercion off for every sibling - silently, so the z.boolean() beside
    // it failed on "on" and the form looked broken.
    const schema = z.object({
      notify: z.boolean(),
      limit: z.number().int(),
      when: z.date().optional(),
    })
    const fd = new FormData()

    fd.append('notify', 'on')
    fd.append('limit', '3')

    expect(decodeFormData(fd, schema)).toEqual({ notify: true, limit: 3 })
  })
})

describe('a blank text input', () => {
  const schema = z.object({
    name: z.string().min(1),
    email: z.email().optional(),
    site: z.string().optional(),
  })

  test('is absent for a string the schema does not require', () => {
    const fd = new FormData()

    fd.append('name', 'Ada')
    fd.append('email', '')
    fd.append('site', '')

    expect(decodeFormData(fd, schema)).toEqual({ name: 'Ada' })
    expect(schema.safeParse(decodeFormData(fd, schema)).success).toBe(true)
  })

  test('and is still "" for one it requires, so the schema can say so', () => {
    const fd = new FormData()

    fd.append('name', '')

    const decoded = decodeFormData(fd, schema)

    expect(decoded).toEqual({ name: '' })
    expect(schema.safeParse(decoded).success).toBe(false)
  })
})
