import { describe, expect, test } from 'bun:test'
import { keyedPayloadUrl, payloadKey, withoutPayloadKey } from '../../src/js/payloadKey'

describe('a payload at its own url', () => {
  test('is keyed on the headers that shape it, whatever their case or order', () => {
    const asked = { 'X-RSC': 'true', 'X-RSC-Version': 'b1', 'X-RSC-Segments': '/,/docs' }
    const received = new Headers({ 'x-rsc-segments': '/,/docs', 'x-rsc': 'true', 'x-rsc-version': 'b1', accept: '*/*', cookie: 'a=1' })

    // The client keys a plain object; the server sees Headers. The same key,
    // and headers that do not shape the answer change nothing.
    expect(payloadKey(asked)).toBe(payloadKey(received))
  })

  test('differs when the answer would: another layout chain, slot or build', () => {
    const base = { 'X-RSC': 'true', 'X-RSC-Version': 'b1' }
    const keys = new Set([
      payloadKey(base),
      payloadKey({ ...base, 'X-RSC-Segments': '/' }),
      payloadKey({ ...base, 'X-RSC-Segments': '/,/docs' }),
      payloadKey({ ...base, 'X-RSC-Intercept': 'modal' }),
      payloadKey({ ...base, 'X-RSC-Version': 'b2' }),
      payloadKey({ ...base, 'X-RSC-Revalidate': 'all' }),
    ])

    expect(keys.size).toBe(6)
  })

  test('keeps the url it was given, query and all, beside the key', () => {
    const headers = { 'X-RSC': '1' }
    const key = payloadKey(headers)

    expect(keyedPayloadUrl('/docs?q=a%20b', headers)).toBe(`/docs?q=a+b&_rsc=${key}`)
    expect(keyedPayloadUrl('https://site.test/docs#top', headers)).toBe(`https://site.test/docs?_rsc=${key}#top`)
  })

  test('reaches the app without its key, so a page never reads it', () => {
    const asked = new Request('https://site.test/docs?page=2&_rsc=abc', { headers: { 'X-RSC': '1' } })
    const seen = withoutPayloadKey(asked)

    expect(seen.url).toBe('https://site.test/docs?page=2')
    expect(seen.headers.get('X-RSC')).toBe('1')
    // A request without one is handed on untouched, and a post is never rebuilt.
    const plain = new Request('https://site.test/docs')
    const post = new Request('https://site.test/_rsc/action?_rsc=x', { method: 'POST', body: 'x' })

    expect(withoutPayloadKey(plain)).toBe(plain)
    expect(withoutPayloadKey(post)).toBe(post)
  })

  test('is the same request each time it is asked for, so what the app marked on it is found again', () => {
    // The host marks notFound() on the request the app saw; the entry in front
    // holds the one that arrived, and asks about it. A second copy broke that,
    // and a missing record showed the root not-found.tsx, not the nearest one.
    const asked = new Request('https://site.test/shop/nope?_rsc=abc', { headers: { 'X-RSC': '1' } })

    expect(withoutPayloadKey(asked)).toBe(withoutPayloadKey(asked))
    expect(withoutPayloadKey(withoutPayloadKey(asked))).toBe(withoutPayloadKey(asked))
  })
})
