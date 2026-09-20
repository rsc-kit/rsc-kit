// Being told a newer build is live.
//
// The situation is real rather than theoretical: this package's worker
// activates immediately rather than waiting for tabs to close, and activating
// sweeps the previous build's cache — so a page open across a deploy is running
// javascript whose remaining chunks are gone. It works until it navigates
// somewhere that needs one.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

let listeners: Record<string, ((event: unknown) => void)[]>
/** Whether a worker was in control when the page loaded - null for a first visit. */
let controller: object | null = {}
let priorNavigator: PropertyDescriptor | undefined

beforeEach(() => {
  listeners = {}
  priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  Object.defineProperty(globalThis, 'navigator', {
    value: {
      serviceWorker: {
        get controller() {
          return controller
        },
        addEventListener: (name: string, fn: (event: unknown) => void) => {
          ;(listeners[name] ??= []).push(fn)
        },
      },
    },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  // Put it back: every test file here shares one process, and a navigator left
  // behind is one the DOM tests get instead of happy-dom's.
  if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator)
  else delete (globalThis as { navigator?: unknown }).navigator
})

/** A fresh copy each time, since the store records into module state. */
const load = () => import(`../../src/js/updateStore?${Math.random()}`)

describe('what counts as news', () => {
  test('nothing, until something says so', async () => {
    const store = await load()

    expect(store.isUpdated()).toBe(false)
  })

  test("the worker's message", async () => {
    const store = await load()

    for (const fn of listeners.message ?? []) fn({ data: { type: 'rsc-kit:updated' } })

    expect(store.isUpdated()).toBe(true)
  })

  test('and a worker taking control after the page loaded, which is the same news', async () => {
    // It fires when the page was open across a deploy and the message was
    // posted before this listener existed.
    controller = {}

    const store = await load()

    for (const fn of listeners.controllerchange ?? []) fn({})

    expect(store.isUpdated()).toBe(true)
  })

  test("but not the first worker a visitor ever gets claiming the page", async () => {
    // Nothing was in control when the page loaded; the claim is an install,
    // not an update, and "a new version is ready" on a first visit was wrong.
    controller = null

    const store = await load()

    for (const fn of listeners.controllerchange ?? []) fn({})

    expect(store.isUpdated()).toBe(false)
  })

  test('but not another message that happens to arrive', async () => {
    const store = await load()

    for (const fn of listeners.message ?? []) fn({ data: { type: 'something-else' } })
    for (const fn of listeners.message ?? []) fn({ data: null })

    expect(store.isUpdated()).toBe(false)
  })
})

describe('subscribers', () => {
  test('are told once and not again', async () => {
    // The value only ever goes false to true, and React compares by value —
    // announcing twice would be a render for no change.
    const store = await load()
    let told = 0

    store.subscribeToUpdates(() => told++)

    for (const fn of listeners.message ?? []) fn({ data: { type: 'rsc-kit:updated' } })
    for (const fn of listeners.message ?? []) fn({ data: { type: 'rsc-kit:updated' } })

    expect(told).toBe(1)
  })

  test('and the server render always says no', async () => {
    // A document that was just sent is by definition not stale, and disagreeing
    // with the client's first read is a hydration mismatch.
    const store = await load()

    expect(store.updatedOnServer()).toBe(false)
  })
})
