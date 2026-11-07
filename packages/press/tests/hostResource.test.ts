import { beforeEach, describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { ActionValidationError } from '@rsc-kit/core/action'
import { saveRecord } from '../src/admin/actions'
import { definePanel } from '../src/admin/panel'
import { defineResource } from '../src/resource'
import { memorySource } from '../src/memory'
import { theme } from './theme'

/**
 * A resource saved by the backend's actions, with no schema in TypeScript: a
 * Laravel FormRequest or a Go struct says what create and update take, and
 * the backend does every check.
 */
type User = { id: string; email: string; role: string; team_id?: string }

const KEY = Symbol.for('rsc-kit.host-forms')
const calls: unknown[][] = []

// What the build generates: stubs that call the backend by name.
const usersStore = async (values: Record<string, unknown>) => {
  calls.push(['Users.store', values])
  if (values.email === 'taken@example.com') throw new ActionValidationError({ email: ['The email has already been taken.'] })

  return { id: '9', ...values }
}
const usersUpdate = async (values: Record<string, unknown>, id: string) => {
  calls.push(['Users.update', values, id])
}
const usersReplace = async (_values: Record<string, unknown>) => {}

const install = () => {
  ;(globalThis as Record<symbol, unknown>)[KEY] = {
    actions: new Map<unknown, string>([
      [usersStore, 'Users.store'],
      [usersUpdate, 'Users.update'],
      [usersReplace, 'Users.replace'],
    ]),
    inputs: {
      'Users.store': {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          role: { type: 'string', enum: ['admin', 'member'] },
          team_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['email', 'password', 'role'],
      },
      'Users.update': {
        type: 'object',
        'x-key': true,
        properties: {
          email: { type: 'string', format: 'email' },
          password: { anyOf: [{ type: 'string', minLength: 8 }, { type: 'null' }] },
          role: { type: 'string', enum: ['admin', 'member'] },
        },
        required: ['email', 'role'],
      },
      'Users.replace': { type: 'object', properties: { email: { type: 'string' } } },
    },
  }
}

const source = () => {
  const memory = memorySource<User, Record<string, unknown>>([{ id: '1', email: 'a@x.test', role: 'member' }], 'id', (id, values) => ({ id: String(id), ...values }) as User)

  return { list: memory.list, find: memory.find, delete: memory.delete }
}

const users = (update: typeof usersUpdate | typeof usersReplace = usersUpdate) =>
  defineResource<User>()({
    name: 'users',
    key: 'id',
    title: 'email',
    source: source(),
    actions: { create: usersStore, update },
    table: (col) => [col.text('email'), col.badge('role')],
    filters: ['role'],
    fields: { team_id: { relation: 'teams', label: 'Team' } },
  })

const teams = defineResource<{ id: string; name: string }>()({
  name: 'teams',
  key: 'id',
  title: 'name',
  source: memorySource<{ id: string; name: string }, { name: string }>([{ id: 't1', name: 'Core' }], 'id', (id, values) => ({ id: String(id), name: values.name })),
  table: (col) => [col.text('name')],
  form: z.object({ name: z.string() }),
})

const submit = (values: Record<string, string>) => {
  const data = new FormData()

  for (const [name, value] of Object.entries(values)) data.set(name, value)

  return data
}

beforeEach(() => {
  calls.length = 0
  install()
})

describe('a resource saved by the backend\'s actions', () => {
  test('waits for the server entry, so it can be defined before it runs', () => {
    delete (globalThis as Record<symbol, unknown>)[KEY]

    expect(() => definePanel({ theme, path: '/h0', resources: [users(), teams] })).not.toThrow()
  })

  test('draws the create form from create, and the edit form from update', () => {
    const resource = users()

    expect(resource.fields.map((field) => [field.name, field.required])).toEqual([
      ['email', true],
      ['password', true],
      ['role', true],
      ['team_id', false],
    ])
    // A password required to create is optional to edit.
    expect(resource.editFields.map((field) => [field.name, field.required])).toEqual([
      ['email', true],
      ['password', false],
      ['role', true],
    ])
    expect(resource.fields.find((field) => field.name === 'team_id')?.relation).toBe('teams')
    expect(resource.filters).toEqual([{ key: 'role', label: 'Role', options: [{ value: 'admin', label: 'Admin' }, { value: 'member', label: 'Member' }] }])
  })

  test('creates with the values alone, and updates with the record\'s key after them', async () => {
    definePanel({ theme, path: '/h1', resources: [users(), teams] })

    await saveRecord('/h1', 'users', null, submit({ email: 'b@x.test', password: 'secret123', role: 'admin', team_id: 't1' })).catch(() => {})
    await saveRecord('/h1', 'users', '1', submit({ email: 'c@x.test', password: '', role: 'member' })).catch(() => {})

    expect(calls).toEqual([
      ['Users.store', { email: 'b@x.test', password: 'secret123', role: 'admin', team_id: 't1' }],
      // An optional field left empty is left out, so the backend keeps what it had.
      ['Users.update', { email: 'c@x.test', role: 'member' }, '1'],
    ])
  })

  test('a backend refusal lands under the fields', async () => {
    definePanel({ theme, path: '/h2', resources: [users(), teams] })

    const refused = await saveRecord('/h2', 'users', null, submit({ email: 'taken@example.com', password: 'secret123', role: 'admin' })).catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(ActionValidationError)
    expect((refused as ActionValidationError).errors).toEqual({ email: ['The email has already been taken.'] })
  })

  test('a relation the visitor cannot see is refused before the backend is asked', async () => {
    definePanel({ theme, path: '/h3', resources: [users(), teams] })

    const refused = await saveRecord('/h3', 'users', null, submit({ email: 'd@x.test', password: 'secret123', role: 'admin', team_id: 'nope' })).catch((error: unknown) => error)

    expect((refused as ActionValidationError).errors).toEqual({ team_id: ['Choose one of the listed teams.'] })
    expect(calls).toEqual([])
  })

  test('an update that cannot be told which record says how to take it', () => {
    expect(() => users(usersReplace).editFields).toThrow('Take the key second')
  })

  test('a relation to a resource the panel does not have fails at startup', () => {
    expect(() => definePanel({ theme, path: '/h4', resources: [users()] })).toThrow('relates to teams')
  })

  test('takes a schema or actions, and not both', () => {
    expect(() =>
      defineResource<User>()({
        name: 'both',
        key: 'id',
        title: 'email',
        source: source(),
        actions: { create: usersStore, update: usersUpdate },
        form: z.object({ email: z.string() }),
        table: () => [],
      } as never),
    ).toThrow('not both')
    expect(() =>
      defineResource<User>()({
        name: 'half',
        key: 'id',
        title: 'email',
        source: source(),
        actions: { create: usersStore } as never,
        table: () => [],
      }),
    ).toThrow('{ create, update }')
  })
})
