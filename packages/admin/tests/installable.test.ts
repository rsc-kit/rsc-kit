import { afterAll, describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { ActionValidationError } from '@rsc-kit/core/action'
import { bulkRecords, deleteRecord, saveRecord } from '../src/actions'
import { digestOf, fetchManifest, manifestProblems, memoryInstallations, newInstallation, publicHttps } from '../src/installable'
import type { PluginManifest, PluginRequest } from '../src/installable'
import { memorySource } from '../src/memory'
import { definePanel } from '../src/panel'
import { allowedResource, panelAt, resourcesFor } from '../src/registry'
import { defineResource } from '../src/resource'
import type { Tenant } from '../src/resource'
import { signedHeaders, verifyPluginRequest } from '../src/signing'

const acme: Tenant = { id: 'acme', name: 'Acme' }
const globex: Tenant = { id: 'globex', name: 'Globex' }

// ------------------------------------------------------------- a plugin, served

type Review = { id: string; author: string; rating: number; productId?: number }

/** What the plugin was sent, verified. */
const received: PluginRequest[] = []
/** The plugin's side of each installation: its secret, and its own rows. */
const secrets = new Map<string, string>()
const reviews = new Map<string, Review[]>()

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/manifest.json') return Response.json(manifest(`${url.origin}/rpc`))
    if (url.pathname === '/moved') return Response.redirect(`${url.origin}/manifest.json`, 302)

    const verified = await verifyPluginRequest<PluginRequest>(request, (id) => secrets.get(id))

    if (!verified) return new Response(null, { status: 401 })

    const call = verified.body
    const rows = reviews.get(verified.installation) ?? []

    received.push(call)
    reviews.set(verified.installation, rows)

    switch (call.type) {
      case 'list':
        return Response.json({ rows, total: rows.length })
      case 'find': {
        const found = rows.find((row) => row.id === call.id)

        return found ? Response.json({ row: found }) : new Response(null, { status: 404 })
      }
      case 'create': {
        if (String(call.values.author).toLowerCase() === 'spam') return Response.json({ errors: { author: ['That author is blocked.'] } }, { status: 422 })

        const row = { id: String(rows.length + 1), ...call.values } as Review

        rows.push(row)

        return Response.json({ row })
      }
      case 'delete':
        reviews.set(verified.installation, rows.filter((row) => row.id !== call.id))

        return Response.json({})
      case 'bulk':
        return Response.json({ message: `Approved ${call.ids.length}.` })
      default:
        return Response.json({})
    }
  },
})

afterAll(() => server.stop(true))

const origin = `http://localhost:${server.port}`

function manifest(endpoint: string): PluginManifest {
  return {
    name: 'reviews',
    label: 'Reviews',
    endpoint,
    scopes: ['read:products'],
    resources: [
      {
        name: 'reviews',
        key: 'id',
        title: 'author',
        columns: [{ key: 'author' }, { key: 'rating', format: 'text' }, { key: 'productId', relation: 'products' }],
        form: {
          type: 'object',
          required: ['author', 'rating'],
          properties: {
            author: { type: 'string', minLength: 2 },
            rating: { type: 'integer', minimum: 1, maximum: 5 },
            productId: { type: 'integer', relation: 'products' },
          },
        },
        bulkActions: [{ name: 'approve', label: 'Approve' }],
      },
    ],
    events: ['products', 'reviews'],
  }
}

// ------------------------------------------------------------- the app's panel

type Product = { id: number; name: string }
const productForm = z.object({ name: z.string() })
const products = defineResource<Product>()({
  name: 'products',
  key: 'id',
  title: 'name',
  source: memorySource<Product, z.infer<typeof productForm>>([{ id: 1, name: 'Lamp' }], 'id', (id, values) => ({ id, ...values })),
  table: (col) => [col.text('name')],
  form: productForm,
})

const local = (url: URL) => url.hostname === 'localhost'
let current: Tenant = acme
const store = memoryInstallations('tests')

definePanel({
  path: '/installs',
  resources: [products],
  tenancy: { tenants: () => [acme, globex], current: () => current, switch: () => {} },
  installs: { store, allow: local },
})

async function install(tenant: Tenant) {
  const fetched = await fetchManifest(`${origin}/manifest.json`, local, ['products'])
  const installation = newInstallation(`${origin}/manifest.json`, fetched)

  await store.add(tenant, installation)
  secrets.set(installation.id, installation.secret)

  return installation
}

const submit = (values: Record<string, string>) => {
  const data = new FormData()

  for (const [key, value] of Object.entries(values)) data.set(key, value)

  return data
}

// ------------------------------------------------------------------- the tests

describe('a manifest', () => {
  const ok = manifest('/rpc')
  const problems = (change: (m: PluginManifest) => unknown) => {
    const copy = structuredClone(ok)

    change(copy)

    return manifestProblems(copy, 'https://plugin.example.com/manifest.json', ['products', 'orders'])
  }

  test('that fits has no problems', () => {
    expect(problems(() => {})).toEqual([])
  })

  test('with a field the panel does not know is refused, since it could be a permission read as nothing', () => {
    expect(problems((m) => ((m as unknown as Record<string, unknown>).admin = true))).toEqual(['manifest: unknown field "admin"'])
  })

  test('reading a resource the panel does not have, or relating to one it was not granted, is refused', () => {
    expect(problems((m) => (m.scopes = ['read:invoices']))).toContain('scopes: read:invoices names a resource this panel does not have')
    expect(problems((m) => (m.scopes = []))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('columns[2].relation: products is neither its own resource nor one its scopes read'),
        expect.stringContaining('productId.relation: products is neither'),
        'events: products is neither its own resource nor one its scopes read',
      ]),
    )
  })

  test('taking a name the panel has, or its own page, is refused', () => {
    expect(problems((m) => (m.resources[0]!.name = 'orders'))).toContain('resources[0].name: this panel already has a resource named orders')
    expect(problems((m) => (m.resources[0]!.name = 'plugins'))).toContain("resources[0].name: plugins is the panel's own")
  })

  test('an endpoint on another origin is refused: a plugin is one origin', () => {
    expect(problems((m) => (m.endpoint = 'https://elsewhere.example.com/rpc'))).toContain('endpoint: must be on the same origin as the manifest')
  })
})

describe('where a panel may send a call', () => {
  test('by default, https to a public name', () => {
    expect(publicHttps(new URL('https://plugin.example.com/x'))).toBe(true)

    for (const url of ['http://plugin.example.com', 'https://localhost', 'https://169.254.169.254', 'https://10.0.0.1', 'https://[::1]', 'https://db.internal']) {
      expect(publicHttps(new URL(url))).toBe(false)
    }
  })

  test('a manifest url that redirects is refused, even to an allowed one', async () => {
    await expect(fetchManifest(`${origin}/moved`, local, ['products'])).rejects.toThrow('could not be fetched')
  })

  test('one the rule does not allow is never fetched', async () => {
    await expect(fetchManifest(`${origin}/manifest.json`, publicHttps, ['products'])).rejects.toThrow('does not install plugins from that address')
  })

  test('what was reviewed has a digest, and the same manifest has the same one', async () => {
    const one = await fetchManifest(`${origin}/manifest.json`, local, ['products'])
    const two = await fetchManifest(`${origin}/manifest.json`, local, ['products'])

    expect(await digestOf(one)).toBe(await digestOf(two))
    expect(await digestOf({ ...one, scopes: [] })).not.toBe(await digestOf(one))
  })
})

describe('a signed call', () => {
  const sign = async (body: string, secret: string, now = Date.now()) =>
    new Request('https://plugin.example.com/rpc', { method: 'POST', body, headers: await signedHeaders('inst-1', secret, body, now) })

  test('verifies with its installation\'s secret', async () => {
    expect(await verifyPluginRequest(await sign('{"a":1}', 's3cret'), () => 's3cret')).toEqual({ installation: 'inst-1', body: { a: 1 } })
  })

  test('is refused when the body changed, the secret differs, the installation is unknown, or it is old', async () => {
    const tampered = await sign('{"a":1}', 's3cret')
    const forged = new Request(tampered.url, { method: 'POST', body: '{"a":2}', headers: tampered.headers })

    expect(await verifyPluginRequest(forged, () => 's3cret')).toBeNull()
    expect(await verifyPluginRequest(await sign('{}', 'other'), () => 's3cret')).toBeNull()
    expect(await verifyPluginRequest(await sign('{}', 's3cret'), () => undefined)).toBeNull()
    expect(await verifyPluginRequest(await sign('{}', 's3cret', Date.now() - 10 * 60_000), () => 's3cret')).toBeNull()
  })

  test('an installation whose secret is empty verifies nothing', async () => {
    expect(await verifyPluginRequest(await sign('{}', 's3cret'), () => '')).toBeNull()
  })
})

describe('an installed plugin', () => {
  test('adds its resources for the tenant that installed it, and no other', async () => {
    current = acme
    await install(acme)

    expect((await allowedResource('/installs', 'reviews')).resource.label).toBe('Reviews')
    expect((await resourcesFor(panelAt('/installs'), { tenant: globex })).map((resource) => resource.name)).toEqual(['products'])

    current = globex
    await expect(allowedResource('/installs', 'reviews')).rejects.toThrow('no resource reviews')
    current = acme
  })

  test('is sent its saves as the form parsed them, with the installation\'s tenant', async () => {
    received.length = 0
    await saveRecord('/installs', 'reviews', null, submit({ author: 'Ada', rating: '5', productId: '1' })).catch(() => {})

    expect(received.find((call) => call.type === 'create')).toEqual({
      type: 'create',
      resource: 'reviews',
      values: { author: 'Ada', rating: 5, productId: 1 },
      tenant: { id: 'acme', name: 'Acme' },
    })
  })

  test('a save the panel can check is refused before the plugin is asked', async () => {
    received.length = 0

    const refused = await saveRecord('/installs', 'reviews', null, submit({ author: 'A', rating: '9' })).catch((error: unknown) => error)

    expect((refused as ActionValidationError).errors).toEqual({ author: ['At least 2 characters'], rating: ['At most 5'] })
    expect(received).toEqual([])
  })

  test('a relation to a product it may read is checked as the visitor before it is sent', async () => {
    const refused = await saveRecord('/installs', 'reviews', null, submit({ author: 'Bea', rating: '4', productId: '99' })).catch((error: unknown) => error)

    expect((refused as ActionValidationError).errors).toEqual({ productId: ['Choose one of the listed products.'] })
  })

  test('its 422 lands under the form\'s fields, as Laravel\'s does', async () => {
    const refused = await saveRecord('/installs', 'reviews', null, submit({ author: 'spam', rating: '3' })).catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(ActionValidationError)
    expect((refused as ActionValidationError).errors).toEqual({ author: ['That author is blocked.'] })
  })

  test('is told of a change to a resource it asked about and may read', async () => {
    received.length = 0
    await saveRecord('/installs', 'products', '1', submit({ name: 'Desk lamp' })).catch(() => {})

    const told = received.find((call) => call.type === 'change')

    expect(told).toMatchObject({ type: 'change', change: { resource: 'products', id: '1', change: 'updated', values: { name: 'Desk lamp' } } })
  })

  test('runs its bulk actions on the rows the visitor can see', async () => {
    received.length = 0
    await bulkRecords('/installs', 'reviews', 'approve', ['1', 'not-there']).catch(() => {})

    expect(received.find((call) => call.type === 'bulk')).toMatchObject({ type: 'bulk', action: 'approve', ids: ['1'] })
  })

  test('is unreachable the moment it is uninstalled', async () => {
    const [installation] = await store.list(acme)

    await store.remove(acme, installation!.id)
    await expect(allowedResource('/installs', 'reviews')).rejects.toThrow('no resource reviews')
    await expect(deleteRecord('/installs', 'reviews', '1')).rejects.toThrow('no resource reviews')
  })
})

describe('a panel that takes installs', () => {
  test('keeps its plugins page: no resource of its own may be named plugins', () => {
    const named = defineResource<Product>()({ ...{ name: 'plugins', key: 'id', title: 'name' }, source: products.source, table: (col) => [col.text('name')], form: productForm })

    expect(() => definePanel({ path: '/clash', resources: [named], installs: { store } })).toThrow('no resource may be named plugins')
  })
})
