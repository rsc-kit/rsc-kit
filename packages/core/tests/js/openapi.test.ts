// An OpenAPI document derived from route.ts files, never written by hand.
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { buildOpenApi, openApiPath } from '../../src/openapi'

describe('openApiPath', () => {
  test('rewrites the segments and names what they bind', () => {
    expect(openApiPath('/api/orders/[id]')).toEqual({ path: '/api/orders/{id}', params: ['id'] })
    expect(openApiPath('/docs/[...path]')).toEqual({ path: '/docs/{path}', params: ['path'] })
    expect(openApiPath('/api/health')).toEqual({ path: '/api/health', params: [] })
  })
})

describe('buildOpenApi', () => {
  const doc = buildOpenApi(
    [
      {
        pattern: '/api/orders/[id]',
        methods: ['GET', 'PATCH'],
        guarded: true,
        module: {
          params: z.object({ id: z.coerce.number().int() }),
          searchParams: z.object({ fields: z.string().optional(), expand: z.boolean() }),
          body: z.object({ title: z.string().min(1) }),
          openapi: { tags: ['Orders'], PATCH: { summary: 'Rename an order' } },
        },
      },
      {
        pattern: '/api/health',
        methods: ['GET'],
        guarded: false,
        module: { openapi: { responses: { 200: { description: 'Alive' } } } },
      },
      // The page that renders the document is a route.ts too, and not the API.
      { pattern: '/reference', methods: ['GET'], guarded: false, module: { openapi: false } },
    ],
    {
      info: { title: 'Shop', version: '2.0.0' },
      servers: [{ url: 'https://shop.test' }],
      security: [{ bearerAuth: [] }],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    },
  ) as any

  test('is a 3.1 document with the info, servers and security given', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info).toEqual({ title: 'Shop', version: '2.0.0' })
    expect(doc.servers).toEqual([{ url: 'https://shop.test' }])
    expect(doc.security).toEqual([{ bearerAuth: [] }])
  })

  test('a path parameter is typed by the params schema, a query one by searchParams', () => {
    const get = doc.paths['/api/orders/{id}'].get

    expect(get.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: expect.objectContaining({ type: 'integer' }) },
      { name: 'fields', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'expand', in: 'query', required: true, schema: { type: 'boolean' } },
    ])
    // No dialect marker per schema: it belongs on the document.
    expect(JSON.stringify(get)).not.toContain('$schema')
  })

  test('a body schema becomes the request body of the methods that carry one', () => {
    const { get, patch } = doc.paths['/api/orders/{id}']

    expect(get.requestBody).toBeUndefined()
    expect(patch.requestBody.content['application/json'].schema.properties.title).toEqual({ type: 'string', minLength: 1 })
    expect(patch.responses['422']).toBeDefined()
  })

  test('a guarded route names the session; the scheme is declared once beside the app\'s own', () => {
    const { get } = doc.paths['/api/orders/{id}']

    expect(get.security).toEqual([{ session: [] }])
    expect(get.responses['401']).toBeDefined()
    expect(doc.components.securitySchemes.session.in).toBe('cookie')
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer')
    expect(doc.paths['/api/health'].get.security).toBeUndefined()
  })

  test('what a route says about itself wins, shared and per method', () => {
    const { get, patch } = doc.paths['/api/orders/{id}']

    expect(get.tags).toEqual(['Orders'])
    expect(get.summary).toBeUndefined()
    expect(patch.tags).toEqual(['Orders'])
    expect(patch.summary).toBe('Rename an order')
    // Declared responses merge onto the derived ones rather than replacing them.
    expect(doc.paths['/api/health'].get.responses).toEqual({ 200: { description: 'Alive' } })
    expect(Object.keys(patch.responses).sort()).toEqual(['200', '401', '403', '422'])
  })

  test('a route that opted out is not in the document', () => {
    expect(doc.paths['/reference']).toBeUndefined()
  })

  test('operation ids are stable and readable', () => {
    expect(doc.paths['/api/orders/{id}'].get.operationId).toBe('getApiOrdersByid')
    expect(doc.paths['/api/health'].get.operationId).toBe('getApiHealth')
  })
})
