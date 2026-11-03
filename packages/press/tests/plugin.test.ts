import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { deleteRecord, saveRecord } from '../src/admin/actions'
import { definePanel } from '../src/admin/panel'
import { theme } from './theme'
import { definePlugin } from '../src/plugin'
import type { RecordChange } from '../src/plugin'
import { defineResource } from '../src/resource'
import { memorySource } from '../src/memory'

/** A panel without tenants: what every data source call is told. */
const none = { tenant: null }

const form = z.object({ name: z.string().min(1) })
type Row = { id: number; name: string }
const things = (name: string, readOnly = false) =>
  defineResource<Row>()({
    name,
    key: 'id',
    title: 'name',
    source: memorySource<Row, z.infer<typeof form>>([{ id: 1, name: 'one' }], 'id', (id, values) => ({ id, ...values })),
    table: (col) => [col.text('name')],
    form,
    readOnly,
  })

const submit = (name: string) => {
  const data = new FormData()

  data.set('name', name)

  return data
}

/** A save ends in redirect(), which throws its signal: run it and keep going. */
const settle = (promise: Promise<unknown>) => promise.then(() => undefined, () => undefined)

describe('a plugin', () => {
  test('adds its resources to the panel', () => {
    const panel = definePanel({ theme, path: '/p1', resources: [things('things')], plugins: [definePlugin({ name: 'x', resources: [things('extra')] })] })

    expect(panel.resources.map((r) => r.name)).toEqual(['things', 'extra'])
  })

  test('installed twice is refused, and so is a resource name it shares with the app', () => {
    const plugin = definePlugin({ name: 'x' })

    expect(() => definePanel({ theme, path: '/p2', resources: [], plugins: [plugin, plugin] })).toThrow('the plugin x is installed twice')
    expect(() =>
      definePanel({ theme, path: '/p3', resources: [things('things')], plugins: [definePlugin({ name: 'y', resources: [things('things')] })] }),
    ).toThrow('two resources are named things')
  })

  test('is told of each create, update and delete, after it happened', async () => {
    const seen: RecordChange[] = []
    const resource = things('things')

    definePanel({ theme, path: '/p4', resources: [resource], plugins: [definePlugin({ name: 'log', onChange: (change) => void seen.push(change) })] })

    await settle(saveRecord('/p4', 'things', null, submit('two')))
    await settle(saveRecord('/p4', 'things', '1', submit('uno')))
    await settle(deleteRecord('/p4', 'things', '2'))

    expect(seen).toEqual([
      { panel: '/p4', resource: 'things', id: '2', change: 'created', values: { name: 'two' }, tenant: null },
      { panel: '/p4', resource: 'things', id: '1', change: 'updated', values: { name: 'uno' }, tenant: null },
      { panel: '/p4', resource: 'things', id: '2', change: 'deleted', tenant: null },
    ])
    expect(await resource.source.find('1', none)).toEqual({ id: 1, name: 'uno' })
  })

  test('a refused save tells nobody', async () => {
    const seen: RecordChange[] = []

    definePanel({ theme, path: '/p5', resources: [things('things')], plugins: [definePlugin({ name: 'log', onChange: (change) => void seen.push(change) })] })
    await settle(saveRecord('/p5', 'things', null, submit('')))

    expect(seen).toEqual([])
  })

  test('one that throws does not undo the change or stop the next plugin', async () => {
    const seen: string[] = []
    const resource = things('things')
    const error = console.error

    console.error = () => {}
    try {
      definePanel({ theme,
        path: '/p6',
        resources: [resource],
        plugins: [
          definePlugin({ name: 'broken', onChange: () => { throw new Error('boom') } }),
          definePlugin({ name: 'after', onChange: (change) => void seen.push(change.change) }),
        ],
      })
      await settle(saveRecord('/p6', 'things', '1', submit('kept')))
    } finally {
      console.error = error
    }

    expect(seen).toEqual(['updated'])
    expect((await resource.source.find('1', none))?.name).toBe('kept')
  })
})

describe('a read-only resource', () => {
  test('cannot be saved or deleted, whatever calls the action', async () => {
    const resource = things('log', true)

    definePanel({ theme, path: '/p7', resources: [resource] })

    await expect(saveRecord('/p7', 'log', null, submit('x'))).rejects.toThrow('log is read-only')
    await expect(deleteRecord('/p7', 'log', '1')).rejects.toThrow('log is read-only')
    expect(await resource.source.find('1', none)).not.toBeNull()
  })
})
