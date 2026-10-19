/**
 * instrumentation.ts's onRequest(): told once each response is over.
 *
 * A page streams, so the handler returns long before the last byte leaves, and
 * a visitor who closes the tab ends the stream early. Only the engine holds the
 * body, so these are the cases it has to tell apart: finished, cut off, failed.
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { observeServed, type ServedRequest } from '../../src/served'

const encoder = new TextEncoder()

function held(): { response: Response; push: (text: string) => void; end: () => void; fail: (error: unknown) => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })

  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }),
    push: (text) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    fail: (error) => controller.error(error),
  }
}

function recorder(): { calls: ServedRequest[]; onRequest: (served: ServedRequest) => void } {
  const calls: ServedRequest[] = []
  return { calls, onRequest: (served) => void calls.push(served) }
}

const request = (url = 'https://app.test/dashboard?token=secret', init: RequestInit = {}) => new Request(url, init)

let consoleError: ReturnType<typeof spyOn> | null = null

afterEach(() => {
  consoleError?.mockRestore()
  consoleError = null
})

describe('onRequest is told when the response is over', () => {
  test('a streamed page: only after the last byte, with the time to it', async () => {
    const stream = held()
    const { calls, onRequest } = recorder()
    const response = await observeServed(request(), async () => stream.response, onRequest)
    const reader = response.body!.getReader()

    stream.push('<html>')
    await reader.read()
    expect(calls).toHaveLength(0)

    await Bun.sleep(20)
    stream.push('</html>')
    stream.end()
    await reader.read()
    await reader.read()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'GET', pathname: '/dashboard', status: 200, aborted: false })
    expect(calls[0].durationMs).toBeGreaterThanOrEqual(15)
    expect('error' in calls[0]).toBe(false)
  })

  test('the body arrives as it was sent, chunk by chunk', async () => {
    const stream = held()
    const response = await observeServed(request(), async () => stream.response, () => {})

    stream.push('one ')
    stream.push('two')
    stream.end()

    expect(await response.text()).toBe('one two')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html')
  })

  test('a visitor who leaves mid-stream: aborted, once', async () => {
    const stream = held()
    const { calls, onRequest } = recorder()
    const response = await observeServed(request(), async () => stream.response, onRequest)
    const reader = response.body!.getReader()

    stream.push('<html>')
    await reader.read()
    await reader.cancel('gone')

    expect(calls).toHaveLength(1)
    expect(calls[0].aborted).toBe(true)
  })

  test('a body that fails partway: the error, not aborted', async () => {
    const stream = held()
    const { calls, onRequest } = recorder()
    const response = await observeServed(request(), async () => stream.response, onRequest)
    const boom = new Error('the render failed')

    stream.fail(boom)
    await response.text().catch(() => {})

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ aborted: false, error: boom })
  })

  test('a handler that throws: a 500 with the error, and the throw still reaches the server', async () => {
    const { calls, onRequest } = recorder()
    const boom = new Error('no route table')

    await expect(observeServed(request(), async () => { throw boom }, onRequest)).rejects.toBe(boom)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ status: 500, aborted: false, error: boom })
  })

  test('a response with no body - a redirect - is over at once', async () => {
    const { calls, onRequest } = recorder()

    await observeServed(request(), async () => new Response(null, { status: 303, headers: { location: '/' } }), onRequest)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ status: 303, aborted: false })
  })
})

describe('what onRequest is given', () => {
  test('the path without its query string', async () => {
    const { calls, onRequest } = recorder()

    await (await observeServed(request(), async () => new Response('ok'), onRequest)).text()

    expect(calls[0].pathname).toBe('/dashboard')
    expect(JSON.stringify(calls[0])).not.toContain('secret')
  })

  test('only the headers the app named, and only those the request had', async () => {
    const { calls, onRequest } = recorder()
    const withHeaders = request('https://app.test/', {
      headers: { 'CF-Ray': 'abc', cookie: 'session=1', authorization: 'Bearer x' },
    })

    await (await observeServed(withHeaders, async () => new Response('ok'), onRequest, ['CF-Ray', 'x-request-id'])).text()

    expect(calls[0].headers).toEqual({ 'cf-ray': 'abc' })
    expect(Object.isFrozen(calls[0].headers)).toBe(true)
  })

  test('no names, no headers', async () => {
    const { calls, onRequest } = recorder()
    const withCookie = request('https://app.test/', { headers: { cookie: 'session=1' } })

    await (await observeServed(withCookie, async () => new Response('ok'), onRequest)).text()

    expect(calls[0].headers).toEqual({})
  })
})

describe('a logger that fails does not fail the page', () => {
  test('a throw is reported, and the body is still sent', async () => {
    consoleError = spyOn(console, 'error').mockImplementation(() => {})

    const response = await observeServed(request(), async () => new Response('the page'), () => {
      throw new Error('logger down')
    })

    expect(await response.text()).toBe('the page')
    expect(consoleError).toHaveBeenCalled()
  })

  test('a rejection is reported too, and never awaited', async () => {
    consoleError = spyOn(console, 'error').mockImplementation(() => {})

    const response = await observeServed(request(), async () => new Response('the page'), () => new Promise((_, reject) => setTimeout(() => reject(new Error('later')), 5)))

    expect(await response.text()).toBe('the page')
    await Bun.sleep(20)
    expect(consoleError).toHaveBeenCalled()
  })
})
