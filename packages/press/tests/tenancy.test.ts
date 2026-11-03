import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { isNotFoundSignal } from '@rsc-kit/core/not-found'
import { deleteRecord, saveRecord, switchTenant } from '../src/admin/actions'
import { memorySource } from '../src/memory'
import { definePanel } from '../src/admin/panel'
import { theme } from './theme'
import { allowedResource } from '../src/admin/registry'
import { defineResource } from '../src/resource'
import type { Tenant } from '../src/resource'
import { perTenant } from '../src/tenant'

const form = z.object({ name: z.string().min(1) })
type Row = { id: number; name: string }

const acme: Tenant = { id: 'acme', name: 'Acme' }
const globex: Tenant = { id: 'globex', name: 'Globex' }
const initech: Tenant = { id: 'initech', name: 'Initech' }

/** Each tenant starts with one row named after it. */
const things = () =>
  defineResource<Row>()({
    name: 'things',
    key: 'id',
    title: 'name',
    source: perTenant((tenant) => memorySource<Row, z.infer<typeof form>>([{ id: 1, name: `${tenant} one` }], 'id', (id, values) => ({ id, ...values }))),
    table: (col) => [col.text('name')],
    form,
  })

/** A visitor in Acme and Globex, whose session says `current`. */
function panelFor(path: string, current: () => Tenant | null) {
  const switched: string[] = []
  const resource = things()
  const panel = definePanel({ theme,
    path,
    resources: [resource],
    tenancy: { tenants: () => [acme, globex], current, switch: (id) => void switched.push(id) },
  })

  return { panel, resource, switched }
}

const submit = (name: string) => {
  const data = new FormData()

  data.set('name', name)

  return data
}

const settle = (promise: Promise<unknown>) => promise.then(() => undefined, () => undefined)

const notFound = async (run: () => Promise<unknown>) => {
  try {
    await run()
  } catch (error) {
    return isNotFoundSignal(error)
  }

  return false
}

describe('a panel with tenants', () => {
  test('tells each data source call the tenant, and a tenant sees only its own rows', async () => {
    const { resource } = panelFor('/t1', () => acme)

    expect((await resource.source.find('1', { tenant: acme }))?.name).toBe('acme one')
    expect((await resource.source.find('1', { tenant: globex }))?.name).toBe('globex one')

    const { context } = await allowedResource('/t1', 'things')

    expect(context).toEqual({ tenant: acme })
  })

  test('refuses a current tenant that is not one of the visitor\'s - a cookie naming someone else\'s', async () => {
    panelFor('/t2', () => initech)

    await expect(allowedResource('/t2', 'things')).rejects.toThrow('not one of this visitor\'s')
  })

  test('answers 404 from its middleware with no tenant chosen, or another\'s', async () => {
    let current: Tenant | null = null
    const { panel } = panelFor('/t3', () => current)

    expect(await notFound(() => panel.middleware())).toBe(true)
    current = initech
    expect(await notFound(() => panel.middleware({ resource: 'things' }))).toBe(true)
    current = acme
    expect(await notFound(() => panel.middleware({ resource: 'things', id: '1' }))).toBe(false)
  })

  test('saves into the current tenant, and an edit of a record that is not there in it is refused', async () => {
    const { resource } = panelFor('/t4', () => acme)

    await settle(saveRecord('/t4', 'things', null, submit('acme two')))
    expect((await resource.source.find('2', { tenant: acme }))?.name).toBe('acme two')
    expect(await resource.source.find('2', { tenant: globex })).toBeNull()

    await expect(saveRecord('/t4', 'things', '99', submit('x'))).rejects.toThrow('no things 99 here')
  })

  test('a delete reaches only the current tenant\'s rows', async () => {
    const { resource } = panelFor('/t5', () => globex)

    await settle(deleteRecord('/t5', 'things', '1'))
    expect(await resource.source.find('1', { tenant: globex })).toBeNull()
    expect(await resource.source.find('1', { tenant: acme })).not.toBeNull()
  })

  test('switches only to one of the visitor\'s tenants', async () => {
    const { switched } = panelFor('/t6', () => acme)

    await settle(switchTenant('/t6', 'globex'))
    await expect(switchTenant('/t6', 'initech')).rejects.toThrow('not one of this visitor\'s tenants')
    expect(switched).toEqual(['globex'])
  })
})
