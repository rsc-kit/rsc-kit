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

/**
 * What the server says when asked whether this page's build is current -
 * 409 is stale, 200 is not - and what the document says it is. Without a
 * document build the news is taken at its word.
 */
let serverAnswer: number | 'down' = 409
let documentBuild: string | null = 'build-a'
const realFetch = globalThis.fetch
const realDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  serverAnswer = 409
  documentBuild = 'build-a'
  ;(globalThis as { fetch: unknown }).fetch = async () => {
    if (serverAnswer === 'down') throw new TypeError('Failed to fetch')

    return new Response(null, { status: serverAnswer })
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => (documentBuild ? { getAttribute: () => documentBuild } : null) },
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: 'https://x.test/' } } })
})

afterEach(() => {
  ;(globalThis as { fetch: unknown }).fetch = realFetch
  if (realDocument) Object.defineProperty(globalThis, 'document', realDocument)
  else delete (globalThis as { document?: unknown }).document
  delete (globalThis as { window?: unknown }).window
})

describe('what counts as news', () => {
  test('nothing, until something says so', async () => {
    const store = await load()

    expect(store.isUpdated()).toBe(false)
  })

  test("the worker's message, once the server confirms this page is the old build", async () => {
    const store = await load()

    for (const fn of listeners.message ?? []) fn({ data: { type: 'rsc-kit:updated' } })
    await settle()

    expect(store.isUpdated()).toBe(true)
  })

  test("not the worker's message about a page that is already the new build", async () => {
    // A page loaded from the network while the new worker was installing is
    // the new build already; told to reload, it reloaded into itself - a
    // document load per deploy per page, for nothing. The server is asked.
    serverAnswer = 200

    const store = await load()

    for (const fn of listeners.message ?? []) fn({ data: { type: 'rsc-kit:updated' } })
    await settle()

    expect(store.isUpdated()).toBe(false)
  })

  test('a server that cannot be asked is read as stale, the safe way round', async () => {
    serverAnswer = 'down'

    const store = await load()

    for (const fn of listeners.message ?? []) fn({ data: { type: 'rsc-kit:updated' } })
    await settle()

    expect(store.isUpdated()).toBe(true)
  })

  test('one deploy, two signals, one request', async () => {
    // The worker's message and controllerchange arrive for the same deploy,
    // and each asked the server. A port counted two HEADs per deploy.
    let asked = 0
    ;(globalThis as { fetch: unknown }).fetch = async () => {
      asked++
      await settle()
      return new Response(null, { status: 409 })
    }

    const store = await load()

    for (const fn of listeners.message ?? []) fn({ data: { type: 'rsc-kit:updated' } })
    for (const fn of listeners.controllerchange ?? []) fn({})
    await settle()
    await settle()

    expect(asked).toBe(1)
    expect(store.isUpdated()).toBe(true)
  })

  test('a document with no build to claim takes the news at its word', async () => {
    documentBuild = null
    serverAnswer = 200

    const store = await load()

    for (const fn of listeners.message ?? []) fn({ data: { type: 'rsc-kit:updated' } })
    await settle()

    expect(store.isUpdated()).toBe(true)
  })

  test('and a worker taking control after the page loaded, which is the same news', async () => {
    // It fires when the page was open across a deploy and the message was
    // posted before this listener existed.
    controller = {}

    const store = await load()

    for (const fn of listeners.controllerchange ?? []) fn({})
    await settle()

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
    await settle()

    expect(told).toBe(1)
  })

  test('and the server render always says no', async () => {
    // A document that was just sent is by definition not stale, and disagreeing
    // with the client's first read is a hydration mismatch.
    const store = await load()

    expect(store.updatedOnServer()).toBe(false)
  })
})
