import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { isNotFoundSignal } from '@rsc-kit/core/not-found'
import { definePanel } from '../src/panel'
import { allowedResource } from '../src/registry'
import { defineResource } from '../src/resource'
import { memorySource } from '../src/memory'

const form = z.object({ name: z.string() })
const things = (name = 'things') =>
  defineResource<{ id: number; name: string }>()({
    name,
    key: 'id',
    title: 'name',
    source: memorySource([], 'id', (id, values: z.infer<typeof form>) => ({ id, ...values })),
    table: (col) => [col.text('name')],
    form,
  })

describe('a panel', () => {
  test('its path is where its routes are, without a trailing slash', () => {
    expect(() => definePanel({ path: '/admin/', resources: [] })).toThrow("a panel's path")
    expect(() => definePanel({ path: 'admin', resources: [] })).toThrow("a panel's path")
    expect(definePanel({ path: '/back-office/admin', resources: [] }).path).toBe('/back-office/admin')
  })

  test('two resources of one name are refused', () => {
    expect(() => definePanel({ path: '/twice', resources: [things(), things()] })).toThrow('two resources are named things')
  })

  test('an action finds its resource through the panel, and only once authorize allows it', async () => {
    let allowed = false

    definePanel({ path: '/guarded', resources: [things()], authorize: () => allowed })

    await expect(allowedResource('/guarded', 'things')).rejects.toThrow('not allowed')
    allowed = true
    expect((await allowedResource('/guarded', 'things')).resource.name).toBe('things')
    await expect(allowedResource('/guarded', 'other')).rejects.toThrow('no resource other')
    await expect(allowedResource('/nowhere', 'things')).rejects.toThrow('no panel at /nowhere')
  })

  test('its middleware answers 404 before anything is sent: a refused visitor, an unknown resource, a missing record', async () => {
    let allowed = true
    const source = memorySource([{ id: 1, name: 'one' }], 'id', (id, values: z.infer<typeof form>) => ({ id, ...values }))
    const panel = definePanel({
      path: '/mw',
      resources: [defineResource<{ id: number; name: string }>()({ name: 'things', key: 'id', title: 'name', source, table: () => [], form })],
      authorize: () => allowed,
    })
    const refused = (params?: Record<string, string>) =>
      panel.middleware(params).then(
        () => false,
        (error) => isNotFoundSignal(error),
      )

    expect(await refused()).toBe(false)
    expect(await refused({ resource: 'things' })).toBe(false)
    expect(await refused({ resource: 'things', id: '1' })).toBe(false)
    expect(await refused({ resource: 'others' })).toBe(true)
    expect(await refused({ resource: 'things', id: '2' })).toBe(true)
    allowed = false
    expect(await refused()).toBe(true)
  })
})
