/**
 * What a re-rendered slot is held in.
 *
 * A slot is the only region smaller than a page the server can name, so it is
 * the unit an action can invalidate on its own — two tables refresh apart from
 * each other only if they are two slots.
 */

import { describe, expect, test, beforeEach } from 'bun:test'
import { clearSlots, getSlotState, setSlot, subscribeToSlot } from '../../src/js/slotStore.ts'

beforeEach(() => {
  clearSlots()
})

describe('slot state', () => {
  test('a slot nobody has written to is empty, which means "use what the server sent"', () => {
    expect(getSlotState('orders').tree).toBeUndefined()
  })

  test('an untouched slot reads as the same object every time', () => {
    // useSyncExternalStore compares snapshots by identity. A fresh object per
    // read is "changed every render", which loops until React throws.
    expect(getSlotState('orders')).toBe(getSlotState('invoices'))
  })

  test('writing one slot leaves the others alone', () => {
    // The whole point: refreshing the orders table must not disturb the
    // invoices table beside it.
    setSlot('orders', 'fresh orders')

    expect(getSlotState('orders').tree).toBe('fresh orders')
    expect(getSlotState('invoices').tree).toBeUndefined()
  })

  test('only the slot that changed notifies', () => {
    const seen: string[] = []
    subscribeToSlot('orders', () => seen.push('orders'))
    subscribeToSlot('invoices', () => seen.push('invoices'))

    setSlot('orders', 'fresh')

    expect(seen).toEqual(['orders'])
  })

  test('a later write replaces the earlier one', () => {
    // Unlike segments, nothing is retained: a slot has one current value.
    setSlot('orders', 'first')
    setSlot('orders', 'second')

    expect(getSlotState('orders').tree).toBe('second')
  })

  test('clearing tells every slot that had something', () => {
    // A navigation replaces the page, and a slot rendered for the page you
    // left has no claim on the one you arrived at.
    const seen: string[] = []
    setSlot('orders', 'x')
    subscribeToSlot('orders', () => seen.push('orders'))
    subscribeToSlot('never-set', () => seen.push('never-set'))

    clearSlots()

    expect(getSlotState('orders').tree).toBeUndefined()
    expect(seen).toEqual(['orders'])
  })

  test('unsubscribing stops the notifications', () => {
    let count = 0
    const stop = subscribeToSlot('orders', () => count++)

    setSlot('orders', 'a')
    stop()
    setSlot('orders', 'b')

    expect(count).toBe(1)
  })
})
