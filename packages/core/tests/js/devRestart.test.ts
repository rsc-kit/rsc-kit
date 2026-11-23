/**
 * What makes the dev server start again.
 *
 * The route table and the host-action stubs are generated in config(), which
 * runs once. A page that did not exist when the server started, or an action
 * a backend wrote since, is not in them - and the file is right there on
 * disk, which is a confusing thing to be told.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rscKit } from '../../src/vite'

type Listener = (file: string) => void

interface Server {
  added: string[]
  listeners: Record<string, Listener[]>
  restarts: number
  restarted: Promise<unknown>
  emit(event: string, file: string): Promise<unknown>
}

let root: string
let server: Server

async function serve(extra: object = {}): Promise<Server> {
  const plugins = rscKit({ projectRoot: root, sourceDir: join(root, 'src'), outDir: join(root, '.rsc-kit'), ...extra }) as Array<{
    name?: string
    config?: (config: object, env: object) => unknown
    configureServer?: { order?: string; handler: (server: unknown) => void }
  }>
  const main = plugins.find((p) => p?.name === 'rsc-kit')!

  await main.config!({}, { command: 'serve', mode: 'development' })

  const fake: Server = {
    added: [],
    listeners: {},
    restarts: 0,
    restarted: Promise.resolve(),
    emit(event, file) {
      for (const listener of fake.listeners[event] ?? []) listener(file)

      return fake.restarted
    },
  }

  main.configureServer!.handler({
    middlewares: { use() {} },
    watcher: {
      add: (path: string) => fake.added.push(path),
      on: (event: string, listener: Listener) => {
        ;(fake.listeners[event] ??= []).push(listener)
      },
    },
    config: { logger: { info() {} }, cacheDir: join(root, 'node_modules/.vite') },
    // A real restart loads vite.config.ts again, and rscKit() reads
    // rsc-host.json anew.
    restart: () => {
      fake.restarts++
      rscKit({ projectRoot: root, sourceDir: join(root, 'src'), outDir: join(root, '.rsc-kit') })

      return fake.restarted
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

  test('when the backend writes the host actions', async () => {
    // make:rsc-action under a running dev server: the class is there, the
    // map is rewritten, and the stub it imports has to be generated again.
    const manifest = join(root, 'rsc-host.json')

    expect(server.added).toContain(manifest)

    writeFileSync(manifest, '{"actions":{"orders":{"save":"Orders.save"}}}')
    await server.emit('add', manifest)
    writeFileSync(manifest, '{"actions":{"orders":{"save":"Orders.save","drop":"Orders.drop"}}}')
    await server.emit('change', manifest)
    rmSync(manifest)
    await server.emit('unlink', manifest)

    expect(server.restarts).toBe(3)
  })

  test('not when the backend rewrites the same host actions', async () => {
    // The manifest command runs on every dev start; a second process starting
    // in the same app - `artisan dev` beside a terminal - rewrote the file
    // with the same bytes and restarted this server for nothing.
    const manifest = join(root, 'rsc-host.json')

    writeFileSync(manifest, '{"actions":{"orders":{"save":"Orders.save"}}}')
    await server.emit('add', manifest)
    writeFileSync(manifest, '{"actions":{"orders":{"save":"Orders.save"}}}')
    await server.emit('change', manifest)

    expect(server.restarts).toBe(1)
  })

  test('when watch runs the backend\'s command and it writes something new', async () => {
    // The command is run by this process, which reads what it wrote at once -
    // before the watcher says the file changed. Compared with what was last
    // read, the change was never news, and a function added in Go stayed
    // untyped until the server was started by hand.
    const backend = join(root, 'backend')
    const manifest = join(root, 'rsc-host.json')

    mkdirSync(backend)
    writeFileSync(join(backend, 'functions.json'), '{"functions":["Orders.recent"]}')
    server = await serve({
      hostManifest: {
        command: [process.execPath, '-e', "require('fs').copyFileSync('backend/functions.json', 'rsc-host.json')"],
        watch: ['backend'],
      },
    })

    writeFileSync(join(backend, 'functions.json'), '{"functions":["Orders.recent","Orders.find"]}')
    server.emit('change', join(backend, 'functions.json'))
    for (let i = 0; i < 100 && !readFileSync(manifest, 'utf-8').includes('Orders.find'); i++) await new Promise((done) => setTimeout(done, 50))
    await server.emit('change', manifest)

    expect(server.restarts).toBe(1)
  })

  test('not when only the lines its functions are on moved, which the editor is told', async () => {
    const manifest = join(root, 'rsc-host.json')
    const map = join(root, '.rsc-kit', 'rsc-env.d.ts.map')
    const wrote = (line: number, functions = ['LoginPage.props']) =>
      writeFileSync(
        manifest,
        JSON.stringify({
          functions,
          types: { 'LoginPage.props': { params: [] } },
          sources: { 'LoginPage.props': { file: 'app/Rsc/LoginPage.php', line } },
        }),
      )

    wrote(7)
    server = await serve()
    const before = readFileSync(map, 'utf-8')
    const types = readFileSync(join(root, '.rsc-kit', 'rsc-env.d.ts'), 'utf-8')

    wrote(9)
    await server.emit('change', manifest)

    expect(server.restarts).toBe(0)
    expect(readFileSync(map, 'utf-8')).not.toBe(before)
    expect(readFileSync(join(root, '.rsc-kit', 'rsc-env.d.ts'), 'utf-8')).toBe(types)

    wrote(9, ['LoginPage.props', 'RegisterPage.props'])
    await server.emit('change', manifest)

    expect(server.restarts).toBe(1)
  })

  test('not for any other file at the project root', () => {
    server.emit('change', join(root, 'package.json'))
    server.emit('add', join(root, 'notes.json'))

    expect(server.restarts).toBe(0)
  })
})

describe('the dev middleware', () => {
  test('is registered before every other plugin\'s', () => {
    // Nitro's dev handler, listed first in an app's config, answered
    // /manifest.webmanifest itself - the page router's 404, or a 500 from a
    // page that could not render for that url - so this never saw it.
    const plugins = rscKit({ projectRoot: root, sourceDir: join(root, 'src'), outDir: join(root, '.rsc-kit') }) as Array<{
      name?: string
      configureServer?: { order?: string }
    }>

    expect(plugins.find((p) => p?.name === 'rsc-kit')!.configureServer!.order).toBe('pre')
  })
})
