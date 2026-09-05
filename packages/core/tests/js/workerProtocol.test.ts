/**
 * The worker, driven over a socket the way PHP drives it.
 *
 * Everything else in this suite calls the engine directly, which skips the
 * transport entirely — the framing, the header/body split, the dispatch. That
 * gap is not theoretical: sending an action body as bytes broke every
 * non-multipart action, and this suite stayed green because nothing here had
 * ever crossed a socket.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { connect } from 'node:net'

const packageRoot = join(import.meta.dir, '../..')
const fixtureDir = join(packageRoot, 'tests/fixtures/rsc-app')
const outDir = join(packageRoot, '.tmp/vite-test')
const bundlePath = join(outDir, 'dist/rsc/index.js')
const LAYOUTS = [{ component: 'app/layout', props: {} }]

let worker: ReturnType<typeof Bun.spawn> | null = null
let socketDir = ''
let socketPath = ''

/** One length-prefixed frame: 4-byte big-endian length, then the payload. */
function frame(payload: string | Uint8Array): Uint8Array {
  const body = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
  const out = new Uint8Array(4 + body.length)
  new DataView(out.buffer).setUint32(0, body.length)
  out.set(body, 4)

  return out
}

/**
 * Send frames and collect the frames that come back, until the socket goes
 * quiet. Payloads are returned as text; every reply in this protocol is JSON.
 */
function exchange(frames: Uint8Array[], quietMs = 900): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    const replies: string[] = []
    let buffer = Buffer.alloc(0)
    let timer: ReturnType<typeof setTimeout> | null = null

    const done = () => {
      socket.end()
      resolve(replies)
    }

    const idle = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(done, quietMs)
    }

    socket.on('connect', () => {
      for (const f of frames) socket.write(f)
      idle()
    })

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])

      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0)
        if (buffer.length < 4 + length) break

        replies.push(buffer.subarray(4, 4 + length).toString('utf-8'))
        buffer = buffer.subarray(4 + length)
      }

      idle()
    })

    socket.on('error', reject)
  })
}

beforeAll(async () => {
  const build = Bun.spawn(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
    cwd: packageRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      RSC_PROJECT_ROOT: packageRoot,
      RSC_SOURCE_DIR: fixtureDir,
      RSC_OUT_DIR: outDir,
      RSC_ASSETS_DIR: join(outDir, 'public'),
      RSC_VITE_CONFIG: join(packageRoot, 'tests/fixtures/vite.rsc.config.mjs'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if ((await build.exited) !== 0) {
    throw new Error(`fixture build failed:\n${await new Response(build.stderr).text()}`)
  }

  socketDir = mkdtempSync(join(tmpdir(), 'rsc-worker-'))
  socketPath = join(socketDir, 'bridge.sock')

  worker = Bun.spawn(['bun', join(packageRoot, 'src/worker.ts')], {
    cwd: packageRoot,
    env: {
      ...process.env,
      RSC_TRANSPORT: 'unix',
      RSC_SOCKET: socketPath,
      RSC_BUNDLE: bundlePath,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for it to be answering rather than guessing at a delay.
  for (let i = 0; i < 100; i++) {
    try {
      const [reply] = await exchange([frame('{"type":"ping"}')], 150)
      if (reply?.includes('pong')) return
    } catch {
      // not listening yet
    }

    await new Promise((r) => setTimeout(r, 100))
  }

  throw new Error('worker never answered a ping')
}, 180_000)

afterAll(() => {
  worker?.kill()
  if (socketDir) rmSync(socketDir, { recursive: true, force: true })
})

/**
 * The server reference id the build assigned to an export.
 *
 * Keyed by a content hash, so it changes whenever the fixture's actions do —
 * recovered from the built module rather than pinned.
 */
function actionId(exportName: string): string {
  const assets = join(outDir, 'dist/rsc/assets')

  for (const file of readdirSync(assets)) {
    const source = readFileSync(join(assets, file), 'utf-8')
    const match = source.match(
      new RegExp(`registerServerReference\\([^,]+,\\s*"([^"]+)",\\s*"${exportName}"\\)`),
    )
    if (match) return `${match[1]}#${exportName}`
  }

  throw new Error(`no registered server action named "${exportName}"`)
}


/** An action's arguments, in the shape PHP writes them: JSON as raw bytes. */
function actionArgs(args: unknown[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(args))
}

interface Timed {
  at: number
  frame: Record<string, unknown>
}

/**
 * Drive a streaming render the way PHP does: register a callback connection,
 * send the request on the main socket, and answer host calls as they arrive.
 *
 * Both sides are timestamped, because the ordering between them is the
 * contract — the shell has to be out before a host call is released, or a slow
 * call holds the whole page.
 */
function streamRun(
  message: Record<string, unknown>,
  answer: (fn: string, args: unknown[]) => Promise<Record<string, unknown>>,
  quietMs = 1500,
  extraFrames: Uint8Array[] = [],
): Promise<{ main: Timed[]; calls: Timed[] }> {
  return new Promise((resolve, reject) => {
    const callbackId = `cb-test-${Math.floor(performance.now() * 1000)}`
    const started = performance.now()
    const main: Timed[] = []
    const calls: Timed[] = []

    const cb = connect(`${socketPath}.cb`)
    let cbBuffer = Buffer.alloc(0)
    let mainSocket: ReturnType<typeof connect> | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
      cb.end()
      mainSocket?.end()
      resolve({ main, calls })
    }

    const idle = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(finish, quietMs)
    }

    const send = (socket: ReturnType<typeof connect>, payload: unknown) =>
      socket.write(frame(JSON.stringify(payload)))

    cb.on('error', reject)
    cb.on('connect', () => {
      send(cb, { type: 'register', id: callbackId })

      mainSocket = connect(socketPath)
      mainSocket.on('error', reject)
      mainSocket.on('connect', () => {
        send(mainSocket!, { ...message, callbackId })
        for (const extra of extraFrames) mainSocket!.write(extra)
        idle()
      })

      let buffer = Buffer.alloc(0)
      mainSocket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])

        while (buffer.length >= 4) {
          const length = buffer.readUInt32BE(0)
          if (buffer.length < 4 + length) break

          main.push({ at: performance.now() - started, frame: JSON.parse(buffer.subarray(4, 4 + length).toString('utf-8')) })
          buffer = buffer.subarray(4 + length)
        }

        idle()
      })
    })

    cb.on('data', async (chunk: Buffer) => {
      cbBuffer = Buffer.concat([cbBuffer, chunk])

      while (cbBuffer.length >= 4) {
        const length = cbBuffer.readUInt32BE(0)
        if (cbBuffer.length < 4 + length) break

        const request = JSON.parse(cbBuffer.subarray(4, 4 + length).toString('utf-8'))
        cbBuffer = cbBuffer.subarray(4 + length)
        calls.push({ at: performance.now() - started, frame: request })
        idle()

        // The whole reply, so a test can answer with a refusal or a redirect
        // rather than only with a value.
        send(cb, { id: request.id, ...(await answer(request.function, request.args ?? [])) })
        idle()
      }
    })
  })
}

describe('the frame protocol', () => {
  test('answers a ping', async () => {
    const [reply] = await exchange([frame('{"type":"ping"}')])

    expect(reply).toContain('pong')
  })

  test('an action body arrives as its own frame, and reaches the action', async () => {
    // The exact shape PHP writes: a header declaring the body's length,
    // followed by the body as raw bytes. Dropping the reader that keeps those
    // two together leaves the action with no arguments at all.
    const args = new TextEncoder().encode(JSON.stringify(['ramon']))
    const id = actionId('greet')

    const replies = await exchange([
      frame(
        JSON.stringify({
          type: 'rsc-action',
          actionId: id,
          bodyEncoding: 'binary',
          bodyLength: args.length,
          contentType: 'text/plain;charset=UTF-8',
        }),
      ),
      frame(args),
    ])

    const combined = replies.join('')

    expect(combined).toContain('action-start')
    expect(combined).toContain('Hi ramon from a server action')
  })

  test('a body of bytes that are not valid UTF-8 survives the socket', async () => {
    // json_encode refuses these outright, which is why the body used to be
    // base64'd into the JSON frame. Nothing encodes them now.
    const bytes = new Uint8Array([0x89, 0x50, 0x00, 0xff, 0xfe, 0xc3, 0x28])

    const replies = await exchange([
      frame(
        JSON.stringify({
          type: 'rsc-action',
          actionId: actionId('greet'),
          bodyEncoding: 'binary',
          bodyLength: bytes.length,
          contentType: 'text/plain;charset=UTF-8',
        }),
      ),
      frame(bytes),
    ])

    // The action cannot parse that as arguments; what matters is that the
    // worker stayed on the protocol and answered rather than desynchronising.
    expect(replies.length).toBeGreaterThan(0)
  })
})

describe('two actions at once', () => {
  // Next queues server actions — one in flight per client — because a response
  // can carry a re-rendered tree and applying two out of order corrupts the
  // page. That is a decision its router made, not something the primitive
  // requires, and nothing here imposes it: the client posts each call as an
  // ordinary fetch and the worker answers on whichever socket asked.

  test('run concurrently rather than queueing behind each other', async () => {
    const send = (label: string, ms: number) => {
      const args = actionArgs([label, ms])

      return exchange([
        frame(JSON.stringify({
          type: 'rsc-action',
          actionId: actionId('overlapping'),
          bodyEncoding: 'binary',
          bodyLength: args.length,
          contentType: 'text/plain;charset=UTF-8',
        })),
        frame(args),
      ])
    }

    const [first, second] = await Promise.all([send('a', 250), send('b', 250)])

    // The frames carry the payload as an escaped JSON string, so read through
    // it rather than matching the escaping.
    const payload = (replies: string[]) =>
      replies
        .map((r) => JSON.parse(r) as { data?: string })
        .map((f) => f.data ?? '')
        .join('')

    expect(payload(first)).toContain('"label":"a"')
    expect(payload(second)).toContain('"label":"b"')

    // Queued, each would enter after the other left and the peak would be 1.
    expect(payload(first)).toContain('"peak":2')
  })

  test('a slow action does not hold up a render on another socket', async () => {
    // The case that matters on Laravel: one visitor submitting a form must not
    // stall another visitor's page.
    const args = actionArgs(['slow', 400])

    const [action, render] = await Promise.all([
      exchange([
        frame(JSON.stringify({
          type: 'rsc-action',
          actionId: actionId('overlapping'),
          bodyEncoding: 'binary',
          bodyLength: args.length,
          contentType: 'text/plain;charset=UTF-8',
        })),
        frame(args),
      ]),
      streamRun(
        { type: 'rsc-stream', component: 'app/feed/page', props: {}, layouts: LAYOUTS },
        async () => ({ result: null }),
      ),
    ])

    expect(action.join('')).toContain('slow')
    expect(render.main.map((f) => f.frame.type)).toContain('stream-end')
  })
})

describe('what a render asks to put on the response', () => {
  // The Laravel path: middleware sets a header, the worker reports it on the
  // frame PHP reads before writing its status line, PHP puts it on the answer.
  // Nothing else in this suite crosses that seam.

  test('headers set by middleware arrive on the stream-start frame', async () => {
    const { main } = await streamRun(
      {
        type: 'rsc-stream',
        component: 'app/writes/page',
        props: {},
        layouts: LAYOUTS,
        url: 'https://x.test/writes',
        headers: {},
      },
      async () => ({ result: null }),
    )

    const start = main.find((f) => f.frame.type === 'stream-start')!.frame as {
      headers?: [string, string][]
    }

    expect(start.headers).toContainEqual(['x-wrote', 'middleware'])
  })

  test('each cookie is its own header, not the last one', async () => {
    // Headers joins Set-Cookie on read; sending it joined gives the browser one
    // malformed cookie and no session.
    const { main } = await streamRun(
      {
        type: 'rsc-stream',
        component: 'app/writes/page',
        props: {},
        layouts: LAYOUTS,
        url: 'https://x.test/writes',
        headers: {},
      },
      async () => ({ result: null }),
    )

    const start = main.find((f) => f.frame.type === 'stream-start')!.frame as {
      headers?: [string, string][]
    }
    const cookies = (start.headers ?? []).filter(([name]) => name.toLowerCase() === 'set-cookie')

    expect(cookies).toHaveLength(2)
    expect(cookies[0][1]).toBe('session=abc; Path=/; HttpOnly')
  })

  test('a route that sets nothing reports nothing', async () => {
    const { main } = await streamRun(
      { type: 'rsc-stream', component: 'app/feed/page', props: {}, layouts: LAYOUTS },
      async () => ({ result: null }),
    )

    const start = main.find((f) => f.frame.type === 'stream-start')!.frame as {
      headers?: [string, string][]
    }

    expect(start.headers ?? []).toHaveLength(0)
  })
})

describe('streaming over the socket', () => {
  test('a render answers stream-start, then chunks, then stream-end', async () => {
    const { main } = await streamRun(
      { type: 'rsc-stream', component: 'app/feed/page', props: {}, layouts: LAYOUTS },
      async () => ({ result: null }),
    )

    const types = main.map((f) => f.frame.type)

    expect(types[0]).toBe('stream-start')
    expect(types.at(-1)).toBe('stream-end')
    expect(types).toContain('stream-chunk')
  })

  test('stream-start goes out before anything is rendered', async () => {
    // PHP flushes its response headers on this frame. Emitting it after the
    // render would hold the headers behind the slowest host call on the page,
    // and waiting for it with a blocking read deadlocks both sides.
    const { main, calls } = await streamRun(
      { type: 'rsc-stream', component: 'app/slow/page', props: {}, layouts: LAYOUTS },
      async (_fn, args) => {
        await new Promise((r) => setTimeout(r, Number(args[0]) || 0))

        return { result: { value: 'done' } }
      },
      2000,
    )

    const start = main.find((f) => f.frame.type === 'stream-start')!

    expect(start).toBeDefined()
    expect(calls.length).toBeGreaterThan(0)
    expect(start.at).toBeLessThan(calls[0].at)
  }, 30_000)

  test('the shell is out before any host call is released', async () => {
    // A host call runs on the thread pumping the socket, so nothing the worker
    // writes reaches the browser while one is in flight. The whole shell —
    // every Suspense fallback in it — has to be drained first, or a slow call
    // strands the page behind it.
    const { main, calls } = await streamRun(
      { type: 'rsc-stream', component: 'app/slow/page', props: {}, layouts: LAYOUTS },
      async (_fn, args) => {
        await new Promise((r) => setTimeout(r, Number(args[0]) || 0))

        return { result: { value: 'done' } }
      },
      2000,
    )

    const firstCall = calls[0]!
    const shell = main
      .filter((f) => f.frame.type === 'stream-chunk' && f.at < firstCall.at)
      .map((f) => String(f.frame.data))
      .join('')

    expect(shell).toContain('slow-shell')
    // Both fallbacks, not merely the first chunk React produced.
    expect(shell).toContain('fast-fallback')
    expect(shell).toContain('slow-fallback')
  }, 30_000)

  test('an html render answers html-start through html-end', async () => {
    const { main } = await streamRun(
      { type: 'rsc-html-stream', component: 'app/feed/page', props: {}, layouts: LAYOUTS },
      async () => ({ result: null }),
    )

    const types = main.map((f) => f.frame.type)

    expect(types[0]).toBe('html-start')
    expect(types).toContain('html-chunk')
    expect(types.at(-1)).toBe('html-end')
  }, 30_000)
})

describe('the request/response messages', () => {
  test('lists the functions it has discovered', async () => {
    const [reply] = await exchange([frame('{"type":"list"}')])

    expect(JSON.parse(reply!)).toHaveProperty('result')
  })

  test('renders a whole document and reports its metadata', async () => {
    const [reply] = await exchange([
      frame(JSON.stringify({ type: 'rsc', component: 'app/slow/page', props: {}, layouts: LAYOUTS })),
    ])

    const { result } = JSON.parse(reply!)

    // Composed against the template on the root layout, not the page's own
    // string — which is why metadata resolves against the whole chain even
    // when the render itself is partial.
    expect(result.metadata.title).toBe('Slow Page · Laravel RSC')
  })

  test('renders a payload for a client that already holds layouts', async () => {
    // The partial-navigation path: `from` is how many layouts to leave out, so
    // the answer composes against what the browser still has mounted.
    const [reply] = await exchange([
      frame(
        JSON.stringify({
          type: 'rsc-payload',
          component: 'app/feed/page',
          props: {},
          layouts: LAYOUTS,
          from: 1,
          pageKey: '/feed',
        }),
      ),
    ])

    const { result } = JSON.parse(reply!)

    expect(result).toHaveProperty('rscPayload')
    expect(String(result.rscPayload)).toContain('Feed content')
  })

  test('renders a PPR shell', async () => {
    // The half a CDN can cache. Its Suspense boundaries are deliberately left
    // unfinished, to be filled in by the browser.
    const [reply] = await exchange([
      frame(
        JSON.stringify({
          type: 'rsc-ppr-shell',
          component: 'app/slow/page',
          props: {},
          layouts: LAYOUTS,
        }),
      ),
    ], 4000)

    const { result } = JSON.parse(reply!)

    expect(result).toHaveProperty('shellHtml')
    expect(String(result.shellHtml)).toContain('slow-fallback')
  }, 30_000)

  test('an unknown component is answered, not ignored', async () => {
    // Silence is indistinguishable from a hung worker: PHP waits out the idle
    // timeout and reports that instead of the name it got wrong.
    const [reply] = await exchange([
      frame(
        JSON.stringify({
          type: 'rsc-stream',
          component: 'app/does-not-exist/page',
          props: {},
          layouts: LAYOUTS,
        }),
      ),
    ])

    expect(reply).toBeDefined()
    expect(JSON.parse(reply!).error).toContain('app/does-not-exist/page')
  }, 30_000)

  test('an unknown message type is answered, not ignored', async () => {
    const [reply] = await exchange([frame('{"type":"nonsense"}')])

    expect(JSON.parse(reply!).error).toContain('nonsense')
  })
})

describe('what a refusal from the host looks like on the wire', () => {
  /**
   * Through an action, because that is where PHP converts these: a
   * validation frame becomes a 422, a redirect a 302, an unauthenticated one
   * a 401. A host call that fails inside a Suspense boundary never gets here
   * — React serializes that into the stream instead.
   */
  async function refusedAction(reply: Record<string, unknown>) {
    const args = new TextEncoder().encode(JSON.stringify(['ramon']))

    const { main } = await streamRun(
      {
        type: 'rsc-action',
        actionId: actionId('needsHost'),
        bodyEncoding: 'binary',
        bodyLength: args.length,
        contentType: 'text/plain;charset=UTF-8',
      },
      async () => reply,
      1500,
      [frame(args)],
    )

    return main.map((f) => f.frame)
  }

  test('a validation failure keeps its field errors', async () => {
    // Losing the fields here loses the message the form was going to show.
    const frames = await refusedAction({
      validation_errors: { title: ['Title is taken'] },
      error: 'invalid',
    })

    const refusal = frames.find((f) => 'validation_errors' in f)

    expect(refusal).toBeDefined()
    expect(refusal!.validation_errors).toEqual({ title: ['Title is taken'] })
  }, 30_000)

  test('a redirect travels as a location', async () => {
    const frames = await refusedAction({ redirect: '/login' })

    expect(frames.find((f) => 'redirect' in f)?.redirect).toBe('/login')
  }, 30_000)

  test('an unauthenticated host call says so', async () => {
    const frames = await refusedAction({ unauthenticated: true, error: 'Unauthenticated.' })

    expect(frames.find((f) => 'unauthenticated' in f)?.unauthenticated).toBe(true)
  }, 30_000)
})

describe('what an action says it invalidated', () => {
  const PAGE = {
    component: 'app/page',
    props: { name: 'ramon' },
    layouts: LAYOUTS,
    loadings: [],
    parallelSlots: { modal: 'app/@modal/default' },
  }

  /** Run needsHost, answering its host call the way PHP would. */
  async function actionAnswering(reply: Record<string, unknown>, page: unknown = PAGE) {
    const args = new TextEncoder().encode(JSON.stringify(['ramon']))

    const { main } = await streamRun(
      {
        type: 'rsc-action',
        actionId: actionId('needsHost'),
        bodyEncoding: 'binary',
        bodyLength: args.length,
        contentType: 'text/plain;charset=UTF-8',
        page,
      },
      async () => reply,
      1500,
      [frame(args)],
    )

    return main
      .map((f) => f.frame)
      .filter((f) => f.type === 'action-chunk')
      .map((f) => String(f.data))
      .join('')
  }

  test('a marked slot comes back rendered, with the answer', async () => {
    // One round trip. The browser is not told what went stale and sent to
    // fetch it — the server knew at the end of the first request.
    const payload = await actionAnswering({ result: null, revalidate: ['modal'] })

    expect(payload).toContain('__rscRevalidated')
    expect(payload).toContain('modal-default')
  }, 30_000)

  test('an action that marks nothing sends no envelope', async () => {
    // Most actions return what changed and the caller sets it. Those pay for
    // nothing: the result is serialized exactly as it was before any of this.
    const payload = await actionAnswering({ result: null })

    expect(payload).not.toContain('__rscRevalidated')
  }, 30_000)

  test('marks do not leak into the next action', async () => {
    await actionAnswering({ result: null, revalidate: ['modal'] })

    const payload = await actionAnswering({ result: null })

    expect(payload).not.toContain('__rscRevalidated')
  }, 30_000)

  test('an action still succeeds when the host could not say where it came from', async () => {
    // A url that no longer routes, or a page needing more than a url to
    // build. Revalidation is an optimisation; the action itself must run.
    const payload = await actionAnswering({ result: null, revalidate: ['modal'] }, null)

    expect(payload).not.toContain('__rscRevalidated')
    expect(payload.length).toBeGreaterThan(0)
  }, 30_000)
})
