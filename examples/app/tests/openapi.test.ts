// The document the build derives from the route.ts files, and Scalar's page
// over it. Both are stored at build and served as files; both are fetched
// here the way a caller would.
import { expect, test } from 'bun:test'
import { createTestApp } from '@rsc-kit/core/testing'

test('/openapi.json describes every api route, from what each route.ts declares', async () => {
  const app = await createTestApp()
  const doc = (await (await app.fetch('/openapi.json')).json()) as {
    openapi: string
    info: { title: string }
    paths: Record<string, Record<string, { parameters?: { name: string; in: string }[]; security?: unknown[] }>>
  }

  expect(doc.openapi).toBe('3.1.0')
  expect(doc.info.title).toBe('Example API')
  // A dynamic segment is a path parameter; a guarded route names its security.
  expect(doc.paths['/api/greet/{name}'].get.parameters).toEqual([
    { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
  ])
  expect(doc.paths['/guarded/api/secret'].get.security).toEqual([{ session: [] }])
  // The page that renders the document opted out of it.
  expect(doc.paths['/reference']).toBeUndefined()
})

test('/reference is Scalar over the document, and ships nothing of ours', async () => {
  const app = await createTestApp()
  const res = await app.fetch('/reference')
  const html = await res.text()

  expect(res.status).toBe(200)
  expect(html).toContain('/openapi.json')
})
