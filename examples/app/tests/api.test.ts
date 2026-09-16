// An api route is a function. Test it like one.
//
// No server, no port, no browser: import the handler, hand it a Request and
// the context the engine would, read the Response. This is what caught
// greet/[name] answering "Hello, undefined" after params became a promise.

import { describe, expect, test } from 'bun:test'
import { GET } from '../src/app/api/greet/[name]/route'
import { GET as health } from '../src/app/api/health/route'

describe('/api/greet/[name]', () => {
  test('greets by name', async () => {
    const res = await GET(new Request('https://app.test/api/greet/ada'), {
      // Awaited by the handler, so it is handed as a promise — the same shape
      // the engine gives it and a page's props have.
      params: Promise.resolve({ name: 'ada' }),
    } as never)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ greeting: 'Hello, ada' })
  })
})

describe('/api/health', () => {
  test('answers', async () => {
    const res = await health(new Request('https://app.test/api/health'), {} as never)

    expect(res.status).toBe(200)
  })
})
