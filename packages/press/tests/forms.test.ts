import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { isActionValidationError } from '@rsc-kit/core/action'
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

    await submitForm('f2', submit({ name: 'Ada', email: 'ada@example.com', message: 'Hello there, friend.' }))

    expect(sent).toEqual([{ name: 'Ada', email: 'ada@example.com', message: 'Hello there, friend.' }])
  })

  test('refuses what does not, under each field, and handles nothing', async () => {
    const sent: unknown[] = []

    defineForm({ name: 'f3', form: schema, theme, handle: (values) => void sent.push(values) })

    const errors = await refusal(submitForm('f3', submit({ name: 'Ada', email: 'nope', message: 'short' })))

    expect(Object.keys(errors ?? {}).sort()).toEqual(['email', 'message'])
    expect(sent).toEqual([])
  })

  test('drops a submission with its bot trap filled, answering as though it worked', async () => {
    const sent: unknown[] = []

    defineForm({ name: 'f4', form: schema, theme, handle: (values) => void sent.push(values) })

    expect(await submitForm('f4', submit({ name: 'Bot', email: 'bot@example.com', message: 'Buy my things today.', homepage: 'https://spam.example' }))).toBeUndefined()
    expect(sent).toEqual([])
  })

  test('is refused a name that is not a url segment, both done and redirect, and a field its trap would shadow', () => {
    expect(() => defineForm({ name: 'Contact Us', form: schema, theme, handle: () => {} })).toThrow('lowercase letters, digits and dashes')
    expect(() => defineForm({ name: 'f5', form: schema, theme, handle: () => {}, done: 'Thanks', redirect: '/thanks' })).toThrow('both done and redirect')
    expect(() => defineForm({ name: 'f6', form: z.object({ homepage: z.string() }), theme, handle: () => {} })).toThrow('bot trap')
  })

  test('that was never defined is not found', async () => {
    expect(submitForm('nowhere', submit({}))).rejects.toThrow('no form named nowhere')
  })
})
