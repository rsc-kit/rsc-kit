import { afterEach, describe, expect, test } from 'bun:test'
import {
  BOOT_HOLD_MS,
  bootToken,
  clearBootPayloads,
  heldBootPayloads,
  holdBootPayload,
  takeBootPayload,
} from '../../src/bootPayloads'

function payload(onCancel?: () => void): ReadableStream {
  return new ReadableStream({
    start: (c) => {
      c.enqueue(new TextEncoder().encode('tree'))
      c.close()
    },
    cancel: () => onCancel?.(),
  })
}

afterEach(clearBootPayloads)

describe('a held boot payload', () => {
  test('is taken once, with the headers it was kept with', () => {
    holdBootPayload('t1', payload(), { 'X-RSC-Layouts': 'app/layout' })

    const kept = takeBootPayload('t1')

    expect(kept?.headers).toEqual({ 'X-RSC-Layouts': 'app/layout' })
    expect(takeBootPayload('t1')).toBeNull()
  })

  test('a token nobody kept is nothing', () => {
    expect(takeBootPayload('nope')).toBeNull()
  })

  test('expired, it is cancelled rather than handed over', () => {
    let cancelled = false

    holdBootPayload('t2', payload(() => (cancelled = true)), {}, 1_000)

    expect(takeBootPayload('t2', 1_000 + BOOT_HOLD_MS)).toBeNull()
    expect(cancelled).toBe(true)
  })

  test('holding sweeps what expired before it', () => {
    let cancelled = 0

    holdBootPayload('old', payload(() => cancelled++), {}, 1_000)
    holdBootPayload('new', payload(() => cancelled++), {}, 1_000 + BOOT_HOLD_MS)

    expect(heldBootPayloads()).toBe(1)
    expect(cancelled).toBe(1)
  })

  test('the oldest goes when too many are held', () => {
    for (let i = 0; i < 500; i++) holdBootPayload('t' + i, payload(), {}, 5_000)

    holdBootPayload('one-more', payload(), {}, 5_000)

    expect(heldBootPayloads()).toBe(500)
    expect(takeBootPayload('t0', 5_000)).toBeNull()
    expect(takeBootPayload('one-more', 5_000)).not.toBeNull()
  })

  test('a token is 128 bits, hex, and never repeats', () => {
    const a = bootToken()

    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(bootToken()).not.toBe(a)
  })
})
