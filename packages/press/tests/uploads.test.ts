import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { defineBlock } from '../src/blocks'
import { fieldsOf, parse } from '../src/resource'
import type { Storage } from '../src/uploads'

/** Keeps uploads in a list, and answers a url for each. */
const bucket = () => {
  const kept: { name: string; field: string; size: number }[] = []
  const storage: Storage = {
    async put(file, { field }) {
      kept.push({ name: file.name, field, size: file.size })

      return `https://cdn.test/${kept.length}-${file.name}`
    },
  }

  return { kept, storage }
}

const png = (name = 'cover.png', bytes = 10) => new File([new Uint8Array(bytes)], name, { type: 'image/png' })
const empty = () => new File([], '', { type: 'application/octet-stream' })

const form = (entries: [string, string | File][]) => {
  const data = new FormData()

  for (const [key, value] of entries) data.append(key, value)

  return data
}

const product = (storage: Storage) => {
  const schema = z.object({ name: z.string().min(2), cover: z.url(), manual: z.url().nullable().optional() })

  return { schema, fields: fieldsOf(schema, { cover: { type: 'image', storage, maxSize: 100 }, manual: { type: 'file', storage, accept: '.pdf' } }) }
}

describe('a file field', () => {
  test('is drawn from plain data: its storage stays on the server', () => {
    const { storage } = bucket()
    const { fields } = product(storage)
    const cover = fields.find((field) => field.name === 'cover')!

    expect(cover).toMatchObject({ type: 'image', required: true, maxSize: 100, accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif' })
    expect(fields.find((field) => field.name === 'manual')).toMatchObject({ type: 'file', required: false, nullable: true, accept: '.pdf' })
    expect(JSON.parse(JSON.stringify(fields))).toEqual(fields)
  })

  test('is nullable however the schema spells it', () => {
    const { storage } = bucket()
    const fields = fieldsOf(z.object({ a: z.string().nullable().optional(), b: z.url().nullable() }), { a: { type: 'image', storage }, b: { type: 'file', storage } })

    expect(fields.map((field) => [field.name, field.required, field.nullable])).toEqual([
      ['a', false, true],
      ['b', false, true],
    ])
  })

  test('needs storage', () => {
    expect(() => fieldsOf(z.object({ cover: z.string() }), { cover: { type: 'image' } })).toThrow('needs storage')
  })

  test('uploads the chosen file and saves what storage answered', async () => {
    const { kept, storage } = bucket()
    const parsed = await parse(product(storage), form([['name', 'Lamp'], ['cover', png()], ['cover', '']]))

    expect(parsed).toEqual({ ok: true, values: { name: 'Lamp', cover: 'https://cdn.test/1-cover.png' } })
    expect(kept).toEqual([{ name: 'cover.png', field: 'cover', size: 10 }])
  })

  test('uploads nothing when the rest of the form is refused', async () => {
    const { kept, storage } = bucket()
    const parsed = await parse(product(storage), form([['name', 'L'], ['cover', png()]]))

    expect(parsed.ok).toBe(false)
    expect(Object.keys(parsed.ok ? {} : parsed.errors)).toEqual(['name'])
    expect(kept).toEqual([])
  })

  test('refuses a file of the wrong type or over the limit, before storing anything', async () => {
    const { kept, storage } = bucket()
    const wrongType = await parse(product(storage), form([['name', 'Lamp'], ['cover', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })]]))
    const tooBig = await parse(product(storage), form([['name', 'Lamp'], ['cover', png('big.png', 101)], ['manual', new File(['x'], 'notes.txt', { type: 'text/plain' })]]))

    expect(wrongType).toEqual({ ok: false, errors: { cover: ['Choose a PNG, JPEG, WebP, GIF or AVIF image.'] } })
    expect(tooBig).toEqual({ ok: false, errors: { cover: ['Choose a file of 100 bytes or less.'], manual: ['That type of file is not accepted here.'] } })
    expect(kept).toEqual([])
  })

  test('keeps what the record had when nothing new is chosen', async () => {
    const { kept, storage } = bucket()
    const current = { name: 'Lamp', cover: 'https://cdn.test/old.png' }
    const parsed = await parse(product(storage), form([['name', 'Lamp'], ['cover', empty()], ['cover', 'https://cdn.test/old.png']]), { current })

    expect(parsed).toEqual({ ok: true, values: { name: 'Lamp', cover: 'https://cdn.test/old.png' } })
    expect(kept).toEqual([])
  })

  test('does not keep a value the record never had: a posted string is not an upload', async () => {
    const { storage } = bucket()
    const forged = form([['name', 'Lamp'], ['cover', 'https://elsewhere.test/x.png']])

    expect(await parse(product(storage), forged)).toEqual({ ok: false, errors: { cover: ['Choose a file.'] } })
    expect(await parse(product(storage), forged, { current: { cover: 'https://cdn.test/old.png' } })).toEqual({ ok: false, errors: { cover: ['Choose a file.'] } })
  })

  test('emptied, saves null when the schema allows it', async () => {
    const { storage } = bucket()
    const current = { name: 'Lamp', cover: 'https://cdn.test/a.png', manual: 'https://cdn.test/m.pdf' }
    const parsed = await parse(product(storage), form([['name', 'Lamp'], ['cover', empty()], ['cover', 'https://cdn.test/a.png'], ['manual', empty()], ['manual', '']]), { current })

    expect(parsed).toEqual({ ok: true, values: { name: 'Lamp', cover: 'https://cdn.test/a.png', manual: null } })
  })
})

describe('a file field in a block', () => {
  const setup = () => {
    const { kept, storage } = bucket()
    const gallery = defineBlock({ name: 'picture', form: z.object({ image: z.url(), caption: z.string().min(2) }), fields: { image: { type: 'image', storage } }, render: () => null })
    const schema = z.object({ body: z.array(z.any()) })

    return { kept, target: { schema, fields: fieldsOf(schema, { body: { blocks: [gallery] } }) } }
  }

  test('is uploaded under its numbered name, and refused there', async () => {
    const { kept, target } = setup()
    const ok = await parse(target, form([['body.0.type', 'picture'], ['body.0.image', png('a.png')], ['body.0.caption', 'Dawn']]))

    expect(ok).toEqual({ ok: true, values: { body: [{ type: 'picture', data: { image: 'https://cdn.test/1-a.png', caption: 'Dawn' } }] } })
    expect(kept.map((upload) => upload.field)).toEqual(['body.0.image'])

    const refused = await parse(target, form([['body.0.type', 'picture'], ['body.0.image', png('b.png')], ['body.0.caption', 'D']]))

    expect(refused.ok ? null : Object.keys(refused.errors)).toEqual(['body.0.caption'])
    expect(kept).toHaveLength(1)
  })

  test('keeps an image the same kind of block already had, wherever it moved', async () => {
    const { kept, target } = setup()
    const current = { body: [{ type: 'picture', data: { image: 'https://cdn.test/old.png', caption: 'Old' } }] }
    const parsed = await parse(
      target,
      form([
        ['body.0.type', 'picture'],
        ['body.0.image', png('new.png')],
        ['body.0.caption', 'New'],
        ['body.1.type', 'picture'],
        ['body.1.image', empty()],
        ['body.1.image', 'https://cdn.test/old.png'],
        ['body.1.caption', 'Old'],
      ]),
      { current },
    )

    expect(parsed.ok && (parsed.values as { body: unknown[] }).body).toEqual([
      { type: 'picture', data: { image: 'https://cdn.test/1-new.png', caption: 'New' } },
      { type: 'picture', data: { image: 'https://cdn.test/old.png', caption: 'Old' } },
    ])
    expect(kept).toHaveLength(1)
  })
})
