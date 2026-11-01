import { describe, expect, test } from 'bun:test'
import { flash } from '../../src/flash'
import { FLASH_COOKIE, readFlash } from '../../src/flashCookie'
import { withRequest, withResponseDraft } from '../../src/request'

/**
 * A message for the next page: "Saved." after a save that redirects. The
 * action writes a cookie, the browser takes it after the navigation. An
 * action's own return value cannot do this - it goes back to a form the
 * redirect has already replaced. No DOM here: happy-dom's Request drops the
 * Cookie header, and the second test is about the cookie that arrived.
 */
const written = (cookie = '') =>
  withRequest(new Request('https://app.test/products', { headers: { cookie } }), () =>
    withResponseDraft(async ({ taken }) => {
      await flash('Saved.')
      await flash('Stock is low.', 'warning')

      return taken().getSetCookie()
    }),
  )

describe('flash() on the server', () => {
  test('queues each message in one short-lived cookie the browser can read', async () => {
    const lines = await written()
    const last = lines.at(-1)!

    expect(last).toStartWith(`${FLASH_COOKIE}=`)
    expect(last).toContain('Max-Age=60')
    expect(last).toContain('Path=/')
    expect(last).not.toContain('HttpOnly')

    const value = decodeURIComponent(last.slice(FLASH_COOKIE.length + 1).split(';')[0]!)

    expect(readFlash(value)).toEqual([
      { message: 'Saved.', kind: 'success' },
      { message: 'Stock is low.', kind: 'warning' },
    ])
  })

  test('keeps a message the browser has not taken yet', async () => {
    const earlier = encodeURIComponent(JSON.stringify([{ message: 'Signed in.', kind: 'info' }]))
    const value = decodeURIComponent((await written(`${FLASH_COOKIE}=${earlier}`)).at(-1)!.split(';')[0]!.split('=')[1]!)

    expect(readFlash(value).map((m) => m.message)).toEqual(['Signed in.', 'Saved.', 'Stock is low.'])
  })
})

describe('reading the cookie', () => {
  test('keeps only well-formed messages, whatever else is in it', () => {
    expect(readFlash('not json')).toEqual([])
    expect(readFlash('{"message":"x"}')).toEqual([])
    expect(readFlash(JSON.stringify([{ message: 'ok', kind: 'nonsense' }, { message: 3 }, null, { kind: 'error' }]))).toEqual([
      { message: 'ok', kind: 'info' },
    ])
  })
})

