/**
 * What makes the dev server start again.
 *
 * The route table and the host-action stubs are generated in config(), which
 * runs once. A page that did not exist when the server started, or an action
 * a backend wrote since, is not in them - and the file is right there on
 * disk, which is a confusing thing to be told.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rscKit } from '../../src/vite'

type Listener = (file: string) => void

interface Server {
  added: string[]
  listeners: Record<string, Listener[]>
  restarts: number
  emit(event: string, file: string): void
}

let root: string
let server: Server

async function serve(): Promise<Server> {
  const plugins = rscKit({ projectRoot: root, sourceDir: join(root, 'src'), outDir: join(root, '.rsc-kit') }) as Array<{
    name?: string
    config?: (config: object, env: object) => unknown
    configureServer?: (server: unknown) => void
  }>
  const main = plugins.find((p) => p?.name === 'rsc-kit')!

  await main.config!({}, { command: 'serve', mode: 'development' })

  const fake: Server = {
    added: [],
    listeners: {},
    restarts: 0,
    emit(event, file) {
      for (const listener of fake.listeners[event] ?? []) listener(file)
    },
  }

  main.configureServer!({
    middlewares: { use() {} },
    watcher: {
      add: (path: string) => fake.added.push(path),
      on: (event: string, listener: Listener) => {
        ;(fake.listeners[event] ??= []).push(listener)
      },
    },
    config: { logger: { info() {} } },
    restart: async () => {
      fake.restarts++
    },
  })

  return fake
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rsc-dev-restart-'))
  mkdirSync(join(root, 'src/app'), { recursive: true })
  writeFileSync(
    join(root, 'src/app/layout.tsx'),
    'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
  )
  writeFileSync(join(root, 'src/app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')
  server = await serve()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the dev server starts again', () => {
  test('when a page appears', () => {
    server.emit('add', join(root, 'src/app/orders/page.tsx'))

    expect(server.restarts).toBe(1)
  })

  test('not when a page is edited', () => {
    server.emit('change', join(root, 'src/app/page.tsx'))

    expect(server.restarts).toBe(0)
  })

  test('when the backend writes the host actions', () => {
    // make:rsc-action under a running dev server: the class is there, the
    // map is rewritten, and the stub it imports has to be generated again.
    const manifest = join(root, 'rsc-host-actions.json')

    expect(server.added).toContain(manifest)

    server.emit('add', manifest)
    server.emit('change', manifest)
    server.emit('unlink', manifest)

    expect(server.restarts).toBe(3)
  })

  test('not for any other file at the project root', () => {
    server.emit('change', join(root, 'package.json'))
    server.emit('add', join(root, 'notes.json'))

    expect(server.restarts).toBe(0)
  })
})
