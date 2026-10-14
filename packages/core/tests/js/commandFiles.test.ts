// What the build makes of src/commands: which files are commands, the table
// and entries it writes, and that an app without commands is built as it was.

import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COMMANDS_MODULE_ID, commandFiles, commandsEntry, commandsEntrySource, commandsModule } from '../../src/commandFiles'
import { compileEntrySource } from '../../src/files'

const dirs: string[] = []

/** A source directory with these files under src/commands, each holding what it is given. */
function sourceWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'rsc-commands-'))

  dirs.push(dir)

  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, 'commands', name.split('/').slice(0, -1).join('/')), { recursive: true })
    writeFileSync(join(dir, 'commands', name), content)
  }

  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const names = (dir: string) => commandFiles(dir).commands.map((c) => c.name)

test('the files directly in src/commands are the commands, by name without the extension', () => {
  const dir = sourceWith({ 'migrate.ts': '', 'work.mjs': '', 'seed.tsx': '', 'sync.js': '' })

  expect(names(dir)).toEqual(['migrate', 'seed', 'sync', 'work'])
  expect(commandFiles(dir).commands[0]?.file).toBe(join(dir, 'commands', 'migrate.ts'))
})

test('no src/commands is no commands, not an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rsc-commands-'))

  dirs.push(dir)
  expect(commandFiles(dir)).toEqual({ commands: [], ignored: [] })
})

test('declaration files, tests, and anything starting with _ or . are not commands', () => {
  const dir = sourceWith({
    'migrate.ts': '',
    'migrate.d.ts': '',
    'migrate.test.ts': '',
    'migrate.spec.js': '',
    '_shared.ts': '',
    '.hidden.ts': '',
    'README.md': '',
    'data.json': '',
  })

  expect(names(dir)).toEqual(['migrate'])
  expect(commandFiles(dir).ignored).toEqual([])
})

test('a folder is not a command, and the build is told so that a nested file is not silently dropped', () => {
  const dir = sourceWith({ 'migrate.ts': '', 'db/seed.ts': '' })
  const { commands, ignored } = commandFiles(dir)

  expect(commands.map((c) => c.name)).toEqual(['migrate'])
  expect(ignored).toHaveLength(1)
  expect(ignored[0]?.path).toBe(join(dir, 'commands', 'db'))
  expect(ignored[0]?.reason).toContain('directly in src/commands')
})

test('a name that could not be typed as one is left out, with the reason', () => {
  const dir = sourceWith({ 'ok.ts': '', 'two words.ts': '', '-flag.ts': '' })
  const { commands, ignored } = commandFiles(dir)

  expect(commands.map((c) => c.name)).toEqual(['ok'])
  expect(ignored.map((i) => i.path)).toEqual([join(dir, 'commands', '-flag.ts'), join(dir, 'commands', 'two words.ts')])
})

test('two files with one name: .ts is the command, and the other is said to be ignored', () => {
  const dir = sourceWith({ 'migrate.js': '', 'migrate.ts': '' })
  const { commands, ignored } = commandFiles(dir)

  expect(commands.map((c) => c.file)).toEqual([join(dir, 'commands', 'migrate.ts')])
  expect(ignored).toHaveLength(1)
  expect(ignored[0]?.path).toBe(join(dir, 'commands', 'migrate.js'))
})

test('a plain string description is read off the source without loading it', () => {
  const dir = sourceWith({
    'a.ts': "export const description = 'Apply the database migrations'\nexport default () => {}",
    'b.ts': 'export const description: string = "Drain the queue"\n',
    'c.ts': 'const description = "not exported"\n',
    'd.ts': 'export const description = `computed ${1 + 1}`\n',
    'e.ts': 'export const description = prefix + "x"\n',
  })
  const byName = Object.fromEntries(commandFiles(dir).commands.map((c) => [c.name, c.description]))

  expect(byName).toEqual({ a: 'Apply the database migrations', b: 'Drain the queue', c: undefined, d: undefined, e: undefined })
})

test('the table imports each command lazily, so the server never evaluates one', () => {
  const module = commandsModule([
    { name: 'migrate', file: '/app/src/commands/migrate.ts', description: 'Apply "all" migrations' },
    { name: 'work', file: '/app/src/commands/work.ts' },
  ])

  expect(module).toContain('"migrate": { load: () => import("/app/src/commands/migrate.ts"), description: "Apply \\"all\\" migrations" },')
  expect(module).toContain('"work": { load: () => import("/app/src/commands/work.ts") },')
  expect(module).not.toMatch(/^import /m)
})

test('a build that carries no commands has an empty table', () => {
  expect(commandsModule([])).toBe('export const commands = {\n\n}\n')
})

test('the entry runs a command over the table with its own register() and shutdown()', () => {
  const entry = commandsEntry('/engine/commands')

  expect(entry).toContain(`from ${JSON.stringify(COMMANDS_MODULE_ID)}`)
  expect(entry).toContain('from "/engine/commands"')
  expect(entry).toContain('export function runCommand(argv: string[], program?: string)')
  expect(entry).toContain('ready: instrumented, shutdown: __instrumentation.shutdown')
})

test('commands.mjs sets the flag before the entry is imported, and does not import the server', () => {
  const source = commandsEntrySource()

  expect(source.indexOf('Symbol.for("rsc-kit.command")')).toBeGreaterThan(-1)
  expect(source.indexOf('Symbol.for("rsc-kit.command")')).toBeLessThan(source.indexOf('import("./_ssr/rsc.mjs")'))
  expect(source).not.toContain('index.mjs')
  expect(source).toContain('process.exit(code)')
})

test('a binary without commands is compiled from exactly the entry it always was', () => {
  const source = compileEntrySource('rsc-static')

  expect(source).toContain('import "./rsc-static-inline.mjs";\nimport "./index.mjs";\n')
  expect(source).not.toContain('argv')
  expect(compileEntrySource('rsc-static', { commands: false })).toBe(source)
})

test('a binary with commands is the server with no arguments, and a command with one', () => {
  const source = compileEntrySource('rsc-static', { commands: true })

  // The server is a dynamic import, and only that: a static one starts the
  // server, and binds its port, before argv could be read.
  expect(source).not.toMatch(/^import "\.\/index\.mjs"/m)
  expect(source).toContain('import("./index.mjs")')
  expect(source).toContain('process.argv.length <= 2')
  expect(source).toContain('import "./rsc-static-inline.mjs";')

  // And no top-level await, which is what stopped --bytecode from applying.
  expect(source).not.toMatch(/^\s*await |= await /m)

  const flag = source.indexOf('Symbol.for("rsc-kit.command")')

  expect(flag).toBeGreaterThan(-1)
  expect(flag).toBeLessThan(source.indexOf('import("./_ssr/rsc.mjs")'))
})
