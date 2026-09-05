// Runtime shim for the worker.
//
// The worker's only runtime-specific surface is the socket server, a yield to
// the event loop, and a directory walk. Bun and Node both provide all three;
// this presents them under one shape so worker.ts never branches.
//
// The write contract is Bun's: write() returns the number of bytes accepted, so
// a partial write can be queued and retried on drain. Node never writes
// partially — it queues internally — so the Node adapter always reports a full
// write and the caller's pending-buffer path simply never engages.

import { createServer } from 'node:net'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export type SocketLike = {
  write(data: string | Uint8Array): number
  flush(): void
  /**
   * Hang up. Optional only because a caller may hold a stub; every real
   * transport has one, and a frame stream that cannot be parsed has to be
   * ended rather than resynchronised — see the invalid-length branch in
   * worker.ts for what resuming costs.
   */
  end?(): void
}

export interface SocketHandlers {
  data(socket: SocketLike, data: Uint8Array): void | Promise<void>
  drain?(socket: SocketLike): void
  open?(socket: SocketLike): void
  close?(socket: SocketLike): void
  error?(socket: SocketLike, error: Error): void
}

export interface ListenOptions {
  unix?: string
  hostname?: string
  port?: number
}

/** True when running under Bun rather than Node. */
export const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

export const runtimeName = isBun ? 'bun' : 'node'

/** Yield to the event loop so queued socket writes flush before continuing. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Every .ts/.js file under dir, as paths relative to it. */
export function scanScripts(dir: string): string[] {
  const found: string[] = []

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const abs = join(current, entry)

      if (statSync(abs).isDirectory()) {
        walk(abs)
      } else if (/\.(ts|js)$/.test(entry)) {
        found.push(relative(dir, abs))
      }
    }
  }

  walk(dir)

  return found
}

export interface Server {
  stop(): void
}

/** Listen on a Unix socket or TCP address, dispatching to Bun-shaped handlers. */
export function listen(options: ListenOptions, handlers: SocketHandlers): Server {
  if (isBun) {
    const server = (globalThis as unknown as { Bun: { listen: (o: unknown) => { stop(): void } } }).Bun.listen({
      ...(options.unix ? { unix: options.unix } : { hostname: options.hostname, port: options.port }),
      socket: handlers,
    })

    return { stop: () => server.stop() }
  }

  return listenOnNode(options, handlers)
}

function listenOnNode(options: ListenOptions, handlers: SocketHandlers): Server {
  const server = createServer((connection) => {
    // One adapter per connection: the worker uses the socket object as a Map
    // key, so it has to be stable for the connection's lifetime.
    const socket: SocketLike = {
      write(data) {
        const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data)

        // Node buffers whatever the kernel would not take, so everything is
        // always accepted. The boolean it returns is a backpressure hint, not
        // a byte count.
        connection.write(buffer)

        return buffer.length
      },
      flush() {},
      end() {
        connection.end()
      },
    }

    connection.on('data', (chunk) => {
      // Always bytes: the socket is never given an encoding, so node hands
      // back a Buffer rather than a string.
      void handlers.data(socket, chunk as Uint8Array)
    })
    connection.on('drain', () => handlers.drain?.(socket))
    connection.on('close', () => handlers.close?.(socket))
    connection.on('error', (error) => handlers.error?.(socket, error))

    handlers.open?.(socket)
  })

  server.on('error', (error) => handlers.error?.(null as unknown as SocketLike, error))

  if (options.unix) {
    server.listen(options.unix)
  } else {
    server.listen(options.port, options.hostname)
  }

  return { stop: () => server.close() }
}
