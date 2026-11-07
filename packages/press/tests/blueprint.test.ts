import { beforeEach, describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import * as z from 'zod'
import { ActionValidationError, isActionValidationError } from '@rsc-kit/core/action'
import { saveRecord } from '../src/admin/actions'
import { definePanel } from '../src/admin/panel'
import { submitForm } from '../src/forms/actions'
import { defineBlueprint } from '../src/forms/blueprint'
import type { FormProps } from '../src/forms/theme'
import { memorySource } from '../src/memory'
import { defineResource } from '../src/resource'
import { theme as panelTheme } from './theme'

/**
 * One form, defined once, drawn by a page and by a panel: the page creates
 * with <profile.Form /> and edits with <profile.Form id values />, and the
 * panel's create and edit pages are the same fields with the same saves.
 */
const BlueprintForm = (_props: FormProps) => null
const theme = { BlueprintForm }

const submit = (values: Record<string, string>) => {
  const data = new FormData()

  for (const [name, value] of Object.entries(values)) data.set(name, value)

  return data
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (isActionValidationError(error) ? error.errors : null),
  )

/** What <blueprint.Form /> hands its theme. */
const drawn = (element: unknown) => (element as ReactElement<FormProps>).props

const schema = z.object({ name: z.string().min(1), email: z.email() })

describe('a blueprint from a schema', () => {
  test('creates without an id, and updates the record with one', async () => {
    const calls: unknown[][] = []

    defineBlueprint({
      name: 'b1',
      form: schema,
      theme,
      handle: (values) => void calls.push(['create', values]),
      update: (values, key) => void calls.push(['update', values, key]),
    })

    await submitForm('b1', null, submit({ name: 'Ada', email: 'ada@example.com' }))
    await submitForm('b1', '7', submit({ name: 'Ada L', email: 'ada@example.com' }))

    expect(calls).toEqual([
      ['create', { name: 'Ada', email: 'ada@example.com' }],
      ['update', { name: 'Ada L', email: 'ada@example.com' }, '7'],
    ])
  })

  test('refuses an update under its fields, as it refuses a create', async () => {
    defineBlueprint({ name: 'b2', form: schema, theme, update: () => {} })

    expect(Object.keys((await refusal(submitForm('b2', '7', submit({ name: '', email: 'nope' })))) ?? {}).sort()).toEqual(['email', 'name'])
  })

  test('draws the record\'s values, and only its own fields of them', () => {
    const profile = defineBlueprint({ name: 'b3', form: schema, theme, update: () => {} })
    const props = drawn(profile.Form({ id: 7, values: { name: 'Ada', email: 'ada@example.com', password_hash: '$2y$...' } }))

    // A record handed over whole would put every column of it in the page.
    expect(props.values).toEqual({ name: 'Ada', email: 'ada@example.com' })
    expect(props.submit).toBe('Save')
    expect(typeof props.action).toBe('function')
  })

  test('keeps its bot trap unless told otherwise', async () => {
    const sent: unknown[] = []
    const open = defineBlueprint({ name: 'b4', form: schema, theme, handle: (values) => void sent.push(values) })
    const closed = defineBlueprint({ name: 'b5', form: schema, theme, honeypot: false, handle: (values) => void sent.push(values) })

    expect(drawn(open.Form({})).honeypot).toBe('homepage')
    expect(drawn(closed.Form({})).honeypot).toBeUndefined()

    await submitForm('b4', null, submit({ name: 'Bot', email: 'bot@example.com', homepage: 'x' }))
    await submitForm('b5', null, submit({ name: 'Ada', email: 'ada@example.com', homepage: 'x' }))

    expect(sent).toEqual([{ name: 'Ada', email: 'ada@example.com' }])
  })

  test('says what it is missing when drawn for what it cannot do', () => {
    const createOnly = defineBlueprint({ name: 'b6', form: schema, theme, handle: () => {} })
    const editOnly = defineBlueprint({ name: 'b7', form: schema, theme, update: () => {} })
    const unthemed = defineBlueprint({ name: 'b8', form: schema, handle: () => {} })

    expect(() => createOnly.Form({ id: '1' })).toThrow('has no update')
    expect(() => editOnly.Form({})).toThrow('has no create')
    expect(() => unthemed.Form({})).toThrow('no theme')
  })

  test('is refused a schema and actions together, or neither', () => {
    expect(() => defineBlueprint({ name: 'b9', form: schema, actions: { create: async () => {} } } as never)).toThrow('not both')
    expect(() => defineBlueprint({ name: 'b10' } as never)).toThrow('not both')
  })
})

describe('a blueprint from the backend\'s actions', () => {
  const KEY = Symbol.for('rsc-kit.host-forms')
  const calls: unknown[][] = []

  const profileStore = async (values: Record<string, unknown>) => {
    calls.push(['Profile.store', values])
    if (values.email === 'taken@example.com') throw new ActionValidationError({ email: ['Taken.'] })
  }
  const profileUpdate = async (values: Record<string, unknown>, key: string) => void calls.push(['Profile.update', values, key])

  beforeEach(() => {
    calls.length = 0
    ;(globalThis as Record<symbol, unknown>)[KEY] = {
      actions: new Map<unknown, string>([
        [profileStore, 'Profile.store'],
        [profileUpdate, 'Profile.update'],
      ]),
      inputs: {
        'Profile.store': {
          type: 'object',
          properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } },
          required: ['email', 'password'],
        },
        'Profile.update': {
          type: 'object',
          'x-key': true,
          properties: { email: { type: 'string', format: 'email' }, password: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
          required: ['email'],
        },
      },
    }
  })

  test('draws create from create and edit from update, and calls each', async () => {
    const profile = defineBlueprint({ name: 'h1', theme, actions: { create: profileStore, update: profileUpdate } })

    expect(profile.fields.map((field) => [field.name, field.required])).toEqual([
      ['email', true],
      ['password', true],
    ])
    expect(profile.editFields.map((field) => [field.name, field.required])).toEqual([
      ['email', true],
      ['password', false],
    ])

    await submitForm('h1', null, submit({ email: 'a@x.test', password: 'secret123' }))
    await submitForm('h1', '3', submit({ email: 'b@x.test', password: '' }))

    expect(calls).toEqual([
      ['Profile.store', { email: 'a@x.test', password: 'secret123' }],
      ['Profile.update', { email: 'b@x.test' }, '3'],
    ])
  })

  test('takes either action alone', () => {
    const settings = defineBlueprint({ name: 'h2', theme, actions: { update: profileUpdate } })

    expect(drawn(settings.Form({ id: '3', values: { email: 'a@x.test' } })).fields.map((field) => field.name)).toEqual(['email', 'password'])
    expect(() => settings.Form({})).toThrow('has no create')
  })

  test('lets the backend\'s refusal reach the fields', async () => {
    defineBlueprint({ name: 'h3', theme, actions: { create: profileStore } })

    expect(await refusal(submitForm('h3', null, submit({ email: 'taken@example.com', password: 'secret123' })))).toEqual({ email: ['Taken.'] })
  })

  test('is the panel\'s form, saving with the same actions', async () => {
    const profile = defineBlueprint({ name: 'h4', actions: { create: profileStore, update: profileUpdate } })
    const memory = memorySource<{ id: string; email: string }, Record<string, unknown>>([{ id: '3', email: 'a@x.test' }], 'id', (id, values) => ({ id: String(id), email: String(values.email) }))
    const people = defineResource<{ id: string; email: string }>()({
      name: 'people',
      key: 'id',
      title: 'email',
      source: { list: memory.list, find: memory.find, delete: memory.delete },
      table: (col) => [col.text('email')],
      form: profile,
    })

    expect(people.fields).toBe(profile.fields)
    expect(people.editFields).toBe(profile.editFields)

    definePanel({ theme: panelTheme, path: '/bp', resources: [people] })

    await saveRecord('/bp', 'people', '3', submit({ email: 'c@x.test', password: '' })).catch(() => {})

    expect(calls).toEqual([['Profile.update', { email: 'c@x.test' }, '3']])
  })
})

describe('a resource with a blueprint', () => {
  const contact = defineBlueprint({ name: 'r1', form: schema })

  test('saves through its source when the blueprint does not save', () => {
    const memory = memorySource<{ id: string; name: string; email: string }, z.infer<typeof schema>>([], 'id', (id, values) => ({ id: String(id), ...values }))

    expect(() =>
      defineResource<{ id: string; name: string; email: string }>()({ name: 'contacts', key: 'id', title: 'name', source: memory, table: () => [], form: contact }),
    ).not.toThrow()
  })

  test('is refused when nothing would save it, or fields said twice', () => {
    const memory = memorySource<{ id: string; name: string; email: string }, z.infer<typeof schema>>([], 'id', (id, values) => ({ id: String(id), ...values }))
    const readOnly = { list: memory.list, find: memory.find, delete: memory.delete }

    expect(() => defineResource<{ id: string; name: string; email: string }>()({ name: 'c2', key: 'id', title: 'name', source: readOnly, table: () => [], form: contact })).toThrow(
      'does not both create and update',
    )
    expect(() =>
      defineResource<{ id: string; name: string; email: string }>()({ name: 'c3', key: 'id', title: 'name', source: memory, table: () => [], form: contact, fields: { name: { label: 'Name' } } } as never),
    ).toThrow('said there, not here')
  })
})
