// A server action, posted the way a browser posts it, validated in Go.
//
// The other Go tests drive rendering. This one drives a mutation over the real
// endpoint: POST /_rsc/action with the id the build assigned and a body
// encodeReply produced, decoded back through the Flight client. Nothing is
// called directly — if the id, the encoding, the host call or the revalidation
// envelope disagreed, this is where it would show.
//
// It answers the question a form asks: can the backend say "this field is
// wrong" and can the browser put that message under that input.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createRscHandler } from '../../src/host'
import { httpHostCalls } from '../../src/hostCalls'
import { buildFixtureOnce, bundlePath, outDir, startGoHost, realFetch } from './goHost'

const hasGo = Bun.which('go') !== null
const SECRET = 'action-secret'

let handle: (request: Request) => Promise<Response | null>
let stop: (() => void) | null = null
let actionId = ''
let encodeReply: (value: unknown) => Promise<string | FormData>
let createFromReadableStream: (stream: ReadableStream, options?: unknown) => Promise<unknown>

beforeAll(async () => {
  if (!hasGo) return

  await buildFixtureOnce()

  const client = await import('react-server-dom-webpack/client.edge')
  encodeReply = client.encodeReply
  createFromReadableStream = client.createFromReadableStream

  // The id the build assigned, read out of the bundle rather than written
  // down here: it is a content hash of the module, so it changes whenever
  // actions.ts does, and a hardcoded one would rot into a 404 that reads as
  // the action being gone.
  const source = await Bun.file(join(outDir, 'dist/rsc/index.js')).text()
  const hash = source.match(/server_references_default = \{\s*"([a-f0-9]+)"/)?.[1]

  if (!hash) throw new Error('could not find the server-reference id in the bundle')

  actionId = `${hash}#createOrder`

  const { address, kill } = await startGoHost(SECRET)
  stop = kill

  const engine = await import(bundlePath)

  handle = createRscHandler({
    engine,
    hostCalls: httpHostCalls({
      endpoint: `${address}/__rsc/host-call`,
      secret: SECRET,
      fetch: realFetch,
    }),
  })
}, 180_000)

afterAll(() => stop?.())

/** Post one action call, exactly as the client runtime does. */
async function callAction(form: FormData, referer?: string): Promise<any> {
  const encoded = await encodeReply([form])
  const wrapped = new Response(encoded as BodyInit)
  const contentType = wrapped.headers.get('content-type') ?? 'text/plain;charset=UTF-8'
  const body = new Uint8Array(await wrapped.arrayBuffer())

  const headers: Record<string, string> = {
    'X-RSC-Action': actionId,
    // The body travels as octet-stream so a host that parses multipart cannot
    // consume it first; its real type rides in its own header.
    'X-RSC-Content-Type': contentType,
    'Content-Type': 'application/octet-stream',
  }

  if (referer) headers['X-RSC-Referer'] = referer

  const response = await handle(
    new Request('http://app.test/_rsc/action', { method: 'POST', headers, body }),
  )

  expect(response?.status).toBe(200)

  return await createFromReadableStream(response!.body as ReadableStream, {
    serverConsumerManifest: { moduleMap: {}, moduleLoading: null },
  })
}

describe.skipIf(!hasGo)('a server action validated in Go', () => {
  test('an invalid submission comes back as field errors, not as a failure', async () => {
    const form = new FormData()

    form.set('name', '')
    form.set('quantity', 'abc')

    const answer = await callAction(form)

    // Returned, not thrown. A rejected server action is serialised opaquely —
    // production keeps only a digest — so throwing would lose every field name
    // here and the form would have nothing to show.
    expect(answer.validationErrors).toEqual({
      name: ['The name field is required.'],
      quantity: ['The quantity must be a number.'],
    })
  })

  test('each field is answered on its own, so a form can mark them separately', async () => {
    const form = new FormData()

    form.set('name', 'a valid name')
    form.set('quantity', '0')

    const answer = await callAction(form)

    expect(Object.keys(answer.validationErrors)).toEqual(['quantity'])
    expect(answer.validationErrors.quantity).toEqual(['The quantity must be at least 1.'])
  })

  test('a valid submission runs the write and returns what Go made', async () => {
    const form = new FormData()

    form.set('name', 'a crate of apples')
    form.set('quantity', '3')

    const answer = await callAction(form)

    // createActionClient wraps a success as { data }, and a refusal as
    // { validationErrors } — one envelope, so a caller never has to guess
    // which shape it got.
    expect(answer.validationErrors).toBeUndefined()
    expect(answer.data.order).toEqual({ name: 'a crate of apples', quantity: 3 })
  })

  // What Go marked stale travels back with the answer, so the list showing the
  // new order re-renders without the browser asking for it.
  test('what Go invalidated is re-rendered into the answer', async () => {
    const form = new FormData()

    form.set('name', 'another crate')
    form.set('quantity', '2')

    const answer = await callAction(form, 'http://app.test/ledger')

    expect(answer.__rscRevalidated).toBeDefined()
    expect(Object.keys(answer.__rscRevalidated)).toContain('orders')
    expect(answer.result.data.order).toEqual({ name: 'another crate', quantity: 2 })
  })

  test('a failed validation invalidates nothing', async () => {
    const form = new FormData()

    form.set('name', '')
    form.set('quantity', '1')

    const answer = await callAction(form, 'http://app.test/ledger')

    expect(answer.__rscRevalidated).toBeUndefined()
    expect(answer.validationErrors.name).toEqual(['The name field is required.'])
  })
})
