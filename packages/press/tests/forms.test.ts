import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { ActionValidationError, isActionValidationError } from '@rsc-kit/core/action'
import { submitForm } from '../src/forms/actions'
import { defineForm } from '../src/forms/form'
import type { FormsTheme } from '../src/forms/theme'

const theme: FormsTheme = { PublicForm: () => null }

const submit = (values: Record<string, string>) => {
  const data = new FormData()

  for (const [key, value] of Object.entries(values)) data.set(key, value)

  return data
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (isActionValidationError(error) ? error.errors : null),
  )

const schema = z.object({ name: z.string().min(1), email: z.email(), message: z.string().min(10) })

describe('a public form', () => {
  test('takes its fields from the schema, with overrides', () => {
    const contact = defineForm({ name: 'f1', form: schema, fields: { message: { type: 'textarea' } }, theme, handle: () => {} })

    expect(contact.fields.map((field) => [field.name, field.type, field.required])).toEqual([
      ['name', 'text', true],
      ['email', 'email', true],
      ['message', 'textarea', true],
    ])
  })

  test('hands what passed the schema to handle', async () => {
    const sent: unknown[] = []

    defineForm({ name: 'f2', form: schema, theme, handle: (values) => void sent.push(values) })

    await submitForm('f2', null, submit({ name: 'Ada', email: 'ada@example.com', message: 'Hello there, friend.' }))

    expect(sent).toEqual([{ name: 'Ada', email: 'ada@example.com', message: 'Hello there, friend.' }])
  })

  test('refuses what does not, under each field, and handles nothing', async () => {
    const sent: unknown[] = []

    defineForm({ name: 'f3', form: schema, theme, handle: (values) => void sent.push(values) })

    const errors = await refusal(submitForm('f3', null, submit({ name: 'Ada', email: 'nope', message: 'short' })))

    expect(Object.keys(errors ?? {}).sort()).toEqual(['email', 'message'])
    expect(sent).toEqual([])
  })

  test('leaves a refusal from handle to reach the form, as a backend\'s 422 does', async () => {
    defineForm({
      name: 'f3b',
      form: schema,
      theme,
      handle: () => {
        // What rpc() throws on a 422.
        throw new ActionValidationError({ email: ['That address is blocked.'] })
      },
    })

    const errors = await refusal(submitForm('f3b', null, submit({ name: 'Ada', email: 'ada@example.com', message: 'Hello there, friend.' })))

    expect(errors).toEqual({ email: ['That address is blocked.'] })
  })

  test('drops a submission with its bot trap filled, answering as though it worked', async () => {
    const sent: unknown[] = []

    defineForm({ name: 'f4', form: schema, theme, handle: (values) => void sent.push(values) })

    expect(await submitForm('f4', null, submit({ name: 'Bot', email: 'bot@example.com', message: 'Buy my things today.', homepage: 'https://spam.example' }))).toBeUndefined()
    expect(sent).toEqual([])
  })

  test('is refused a name that is not a url segment, both done and redirect, and a field its trap would shadow', () => {
    expect(() => defineForm({ name: 'Contact Us', form: schema, theme, handle: () => {} })).toThrow('lowercase letters, digits and dashes')
    expect(() => defineForm({ name: 'f5', form: schema, theme, handle: () => {}, done: 'Thanks', redirect: '/thanks' })).toThrow('both done and redirect')
    expect(() => defineForm({ name: 'f6', form: z.object({ homepage: z.string() }), theme, handle: () => {} })).toThrow('bot trap')
  })

  test('that was never defined is not found', async () => {
    expect(submitForm('nowhere', null, submit({}))).rejects.toThrow('no form named nowhere')
  })
})

describe('a form from a backend function', () => {
  const KEY = Symbol.for('rsc-kit.host-forms')
  const calls: unknown[][] = []

  // What the build generates: a stub that calls the backend by name.
  const contactSend = async (values: Record<string, unknown>) => {
    calls.push(['Contact.send', values])
    if ((values as { email: string }).email === 'taken@example.com') throw new ActionValidationError({ email: ['Taken.'] })
  }
  const avatarsSet = async (_values: Record<string, unknown>) => {}
  const typo = async (_values: Record<string, unknown>) => {}

  const install = () => {
    ;(globalThis as Record<symbol, unknown>)[KEY] = {
      actions: new Map<unknown, string>([
        [contactSend, 'Contact.send'],
        [avatarsSet, 'Avatars.set'],
        [typo, 'Contact.sned'],
      ]),
      inputs: {
        'Contact.send': {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 2 },
            email: { type: 'string', format: 'email' },
            age: { anyOf: [{ type: 'integer', minimum: 18 }, { type: 'null' }] },
            topic: { type: 'string', enum: ['sales', 'support'] },
            terms: { type: 'boolean' },
          },
          required: ['email', 'name', 'terms', 'topic'],
        },
        'Avatars.set': { type: 'object', properties: { photo: {} } },
      },
    }
  }

  test('waits for the server entry, so a form can be defined before it runs', () => {
    delete (globalThis as Record<symbol, unknown>)[KEY]

    expect(() => defineForm({ name: 'h1', action: contactSend, theme })).not.toThrow()
  })

  test('draws what the backend says it takes, with the checks the browser can make', () => {
    install()

    const form = defineForm({ name: 'h2', action: contactSend, fields: { name: { label: 'Your name' } }, theme })

    expect(form.fields.map((field) => [field.name, field.type, field.required])).toEqual([
      ['name', 'text', true],
      ['email', 'email', true],
      ['age', 'number', false],
      ['topic', 'select', true],
      ['terms', 'toggle', true],
    ])
    expect(form.fields[0]).toMatchObject({ label: 'Your name', minLength: 2 })
    expect(form.fields[2]).toMatchObject({ min: 18, step: 1 })
  })

  test('sends the values through the generated action', async () => {
    install()
    calls.length = 0
    defineForm({ name: 'h3', action: contactSend, theme })

    await submitForm('h3', null, submit({ name: 'Ada', email: 'ada@example.com', age: '36', topic: 'sales', terms: 'on' }))

    expect(calls).toEqual([['Contact.send', { name: 'Ada', email: 'ada@example.com', age: 36, topic: 'sales', terms: true }]])
  })

  test('leaves every check to the backend, whose refusal lands under its field', async () => {
    install()
    defineForm({ name: 'h4', action: contactSend, theme })

    expect(await refusal(submitForm('h4', null, submit({ name: 'Ada', email: 'taken@example.com', topic: 'sales', terms: 'on' })))).toEqual({ email: ['Taken.'] })
  })

  test('still drops what a bot filled in, without calling the backend', async () => {
    install()
    calls.length = 0
    defineForm({ name: 'h5', action: contactSend, theme })

    await submitForm('h5', null, submit({ name: 'Bot', email: 'bot@example.com', homepage: 'http://spam.example' }))

    expect(calls).toEqual([])
  })

  test('says so for a function it cannot draw', () => {
    install()

    expect(() => defineForm({ name: 'h6', action: typo, theme }).fields).toThrow('Contact.sned')
    expect(() => defineForm({ name: 'h7', action: avatarsSet, theme }).fields).toThrow('photo')
    expect(defineForm({ name: 'h8', action: avatarsSet, fields: { photo: { type: 'text' } }, theme }).fields[0]?.name).toBe('photo')
  })

  test('says so for a function the build did not generate', () => {
    install()

    expect(() => defineForm({ name: 'h11', action: async () => {}, theme }).fields).toThrow('not one the build generated')
  })

  test('points a name at the generated action', () => {
    expect(() => defineForm({ name: 'h12', action: 'Contact.send', theme } as never)).toThrow('import { contactSend }')
  })

  test('takes a schema or an action, not both', () => {
    expect(() => defineForm({ name: 'h9', theme } as never)).toThrow('not both')
    expect(() => defineForm({ name: 'h10', form: schema, action: contactSend, theme, handle: () => {} } as never)).toThrow('not both')
  })
})
