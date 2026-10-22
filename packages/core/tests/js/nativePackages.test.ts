// Native packages in a compiled binary: which packages travel for which
// platform, the names rewritten so a package finds its dependencies on disk,
// the tree the compile is pointed at, and what the binary does with it at
// start - write once, share, and clear away what nothing uses.

import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseAst } from 'vite'
import {
  missingMessage,
  nativeSet,
  rewriteSpecifiers,
  runsOn,
  RUNTIME_SOURCE,
  targetPlatform,
  writeCompileTree,
} from '../../src/native'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rsc-native-'))
  dirs.push(dir)
  return dir
}

function write(root: string, files: Record<string, string | object>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
}

const parse = (code: string) => parseAst(code)
const mac = { os: 'darwin', arch: 'arm64' }

/** A server as Nitro leaves it after tracing sharp on an Apple Silicon Mac. */
function tracedSharp(root: string) {
  write(root, {
    'project/package.json': { name: 'app', scripts: {} },
    'project/.output/server/index.mjs': 'import "./_ssr/rsc.mjs";\n',
    'project/.output/server/_ssr/rsc.mjs': 'import sharp from "sharp";\nexport default sharp;\n',
    'project/.output/server/compile.mjs': 'import "./rsc-static-inline.mjs";\nimport "./index.mjs";\n',
    'project/.output/server/rsc-static-inline.mjs': '',
    'project/.output/server/node_modules/sharp/package.json': {
      name: 'sharp',
      version: '1.0.0',
      exports: { '.': { import: './dist/index.mjs', require: './dist/index.cjs' } },
      dependencies: { 'detect-libc': '1.0.0' },
      optionalDependencies: { '@img/sharp-darwin-arm64': '1.0.0', '@img/sharp-linux-x64': '1.0.0', '@img/sharp-linuxmusl-x64': '1.0.0' },
    },
    'project/.output/server/node_modules/sharp/dist/index.mjs':
      'import { family } from "detect-libc";\nexport default () => family;\n',
    'project/.output/server/node_modules/detect-libc/package.json': { name: 'detect-libc', version: '1.0.0', main: 'lib/detect-libc.js' },
    'project/.output/server/node_modules/detect-libc/lib/detect-libc.js': 'exports.family = "glibc"\n',
    'project/.output/server/node_modules/@img/sharp-darwin-arm64/package.json': {
      name: '@img/sharp-darwin-arm64',
      version: '1.0.0',
      os: ['darwin'],
      cpu: ['arm64'],
    },
    'project/.output/server/node_modules/@img/sharp-darwin-arm64/lib/sharp.node': 'darwin binary',
  })

  return { server: join(root, 'project/.output/server'), project: join(root, 'project') }
}

test('the platform is the compile script target, or the build machine without one', () => {
  expect(targetPlatform('bun build --compile x.mjs', mac)).toEqual(mac)
  expect(targetPlatform(undefined, mac)).toEqual(mac)
  expect(targetPlatform('bun build --compile --target=bun-linux-x64 x', mac)).toEqual({ os: 'linux', arch: 'x64', libc: 'glibc' })
  expect(targetPlatform('bun build --compile --target bun-linux-arm64-musl x', mac)).toEqual({ os: 'linux', arch: 'arm64', libc: 'musl' })
  expect(targetPlatform('bun build --compile --target=bun-linux-x64-baseline x', mac)).toEqual({ os: 'linux', arch: 'x64', libc: 'glibc' })
  expect(targetPlatform('bun build --compile --target=bun-windows-x64 x', mac)).toEqual({ os: 'win32', arch: 'x64' })
})

test("a package's os, cpu and libc are read the way npm reads them", () => {
  const linux = { os: 'linux', arch: 'x64', libc: 'glibc' as const }

  expect(runsOn({}, linux)).toBe(true)
  expect(runsOn({ os: ['linux'], cpu: ['x64'] }, linux)).toBe(true)
  expect(runsOn({ os: ['darwin'] }, linux)).toBe(false)
  expect(runsOn({ os: ['!win32'] }, linux)).toBe(true)
  expect(runsOn({ libc: ['musl'] }, linux)).toBe(false)
  // libc says nothing off linux.
  expect(runsOn({ libc: ['glibc'] }, mac)).toBe(true)
})

test("compiled for the build machine, the traced packages travel as they are", () => {
  const { server, project } = tracedSharp(scratch())
  const { packages, missing } = nativeSet(join(server, 'node_modules'), project, mac)

  expect(missing).toEqual([])
  expect([...packages.keys()].sort()).toEqual(['@img/sharp-darwin-arm64', 'detect-libc', 'sharp'])
})

test('a package with nothing native stays in the bundle, and an app with only those keeps its entry', () => {
  const root = scratch()

  write(root, {
    'server/compile.mjs': 'import "./index.mjs";\n',
    'server/index.mjs': 'import "reflect-metadata";\n',
    'server/node_modules/.nf3/reflect-metadata@0.2.2/package.json': { name: 'reflect-metadata', version: '0.2.2', main: 'Reflect.js' },
    'server/node_modules/.nf3/reflect-metadata@0.2.2/Reflect.js': '',
  })
  symlinkSync('.nf3/reflect-metadata@0.2.2', join(root, 'server/node_modules/reflect-metadata'))

  expect([...nativeSet(join(root, 'server/node_modules'), root, mac).packages.keys()]).toEqual([])
  expect(writeCompileTree({ serverDir: join(root, 'server'), projectRoot: root, target: mac, parse })).toBeUndefined()
  expect(readFileSync(join(root, 'server/compile.mjs'), 'utf-8')).toBe('import "./index.mjs";\n')
})

test('one named in serverExternalPackages goes to disk, with what it depends on', () => {
  const root = scratch()

  write(root, {
    'server/node_modules/reads-files/package.json': { name: 'reads-files', version: '1.0.0', dependencies: { helper: '1.0.0' } },
    'server/node_modules/helper/package.json': { name: 'helper', version: '1.0.0' },
    'server/node_modules/tslib/package.json': { name: 'tslib', version: '2.0.0' },
  })

  expect([...nativeSet(join(root, 'server/node_modules'), root, mac, ['reads-files']).packages.keys()].sort()).toEqual([
    'helper',
    'reads-files',
  ])
})

test("a traced package linked from Nitro's store is followed", () => {
  const root = scratch()
  const { server, project } = tracedSharp(root)

  renameSync(join(server, 'node_modules/sharp'), join(server, 'node_modules/.nf3-sharp'))
  symlinkSync('.nf3-sharp', join(server, 'node_modules/sharp'))

  const tree = writeCompileTree({ serverDir: server, projectRoot: project, target: mac, parse })

  expect(tree && 'packages' in tree && tree.packages.sort()).toEqual(['@img/sharp-darwin-arm64', 'detect-libc', 'sharp'])
  expect(existsSync(join(server, '../compile/.native/node_modules/sharp/dist/index.mjs'))).toBe(true)
  expect(readFileSync(join(server, '../compile/node_modules/sharp/index.cjs'), 'utf-8')).toContain('rsc-kit-native.cjs')
})

test("compiled for another platform without its packages, they are named, with the command that installs them", () => {
  const { server, project } = tracedSharp(scratch())
  const linux = { os: 'linux', arch: 'x64', libc: 'glibc' as const }
  const { missing } = nativeSet(join(server, 'node_modules'), project, linux)

  expect(missing).toEqual([{ name: '@img/sharp-linux-x64', version: '1.0.0' }])

  const message = missingMessage(missing, linux, mac)
  expect(message).toContain('@img/sharp-linux-x64@1.0.0')
  expect(message).toContain('bun install --os=darwin --os=linux --cpu=arm64 --cpu=x64')
})

test('musl asks for the linuxmusl package', () => {
  const { server, project } = tracedSharp(scratch())
  const { missing } = nativeSet(join(server, 'node_modules'), project, { os: 'linux', arch: 'x64', libc: 'musl' })

  expect(missing.map((m) => m.name)).toEqual(['@img/sharp-linuxmusl-x64'])
})

test("compiled for another platform with its packages installed, those replace the build machine's", () => {
  const root = scratch()
  const { server, project } = tracedSharp(root)

  write(root, {
    'project/node_modules/@img/sharp-linux-x64/package.json': { name: '@img/sharp-linux-x64', version: '1.0.0', os: ['linux'], cpu: ['x64'] },
    'project/node_modules/@img/sharp-linux-x64/lib/sharp.node': 'linux binary',
  })

  const { packages, missing } = nativeSet(join(server, 'node_modules'), project, { os: 'linux', arch: 'x64', libc: 'glibc' })

  expect(missing).toEqual([])
  expect(packages.get('@img/sharp-linux-x64')).toBe(join(project, 'node_modules/@img/sharp-linux-x64'))
  expect(packages.has('@img/sharp-darwin-arm64')).toBe(false)
})

test('a platform package with no counterpart for the target is left behind, not reported', () => {
  const root = scratch()
  const { server, project } = tracedSharp(root)

  write(root, {
    'project/.output/server/node_modules/fsevents/package.json': { name: 'fsevents', version: '2.0.0', os: ['darwin'] },
  })

  const { packages, missing } = nativeSet(join(server, 'node_modules'), project, { os: 'linux', arch: 'x64', libc: 'glibc' })

  expect(packages.has('fsevents')).toBe(false)
  expect(missing.map((m) => m.name)).toEqual(['@img/sharp-linux-x64'])
})

test('names in imports and requires become paths into the tree; anything else is left', () => {
  const root = scratch()

  write(root, {
    'node_modules/a/package.json': { name: 'a', main: 'index.js' },
    'node_modules/a/index.js': '',
    'node_modules/b/package.json': { name: 'b', exports: { '.': { import: './b.mjs', require: './b.cjs' }, './sub': './sub.js' } },
    'node_modules/b/b.mjs': '',
    'node_modules/b/b.cjs': '',
    'node_modules/b/sub.js': '',
    'node_modules/host/node_modules/a/package.json': { name: 'a', main: 'nested.js' },
    'node_modules/host/node_modules/a/nested.js': '',
  })

  const file = join(root, 'node_modules/host/index.js')
  const code = [
    'import x from "b";',
    'export { y } from "b/sub";',
    'const a = require("a");',
    'const b = require("b");',
    'const lazy = () => import("a");',
    'const fs = require("node:fs"), path = require("path");',
    'const gone = require("not-installed");',
    'const computed = require(name);',
  ].join('\n')

  const out = rewriteSpecifiers(code, file, root, parse)

  expect(out).toContain('import x from "../b/b.mjs"')
  expect(out).toContain('export { y } from "../b/sub.js"')
  // The nearest one wins, as Node walks node_modules.
  expect(out).toContain('require("./node_modules/a/nested.js")')
  expect(out).toContain('require("../b/b.cjs")')
  expect(out).toContain('import("./node_modules/a/nested.js")')
  expect(out).toContain('require("node:fs"), path = require("path")')
  expect(out).toContain('require("not-installed")')
  expect(out).toContain('require(name)')
})

test('a file the parser cannot read is left whole', () => {
  expect(rewriteSpecifiers('return require("a") +', '/x/index.js', '/x', parse)).toBe('return require("a") +')
})

test('an app with nothing traced keeps the compile entry it had', () => {
  const root = scratch()

  write(root, { 'server/compile.mjs': 'import "./index.mjs";\n', 'server/index.mjs': '' })

  expect(writeCompileTree({ serverDir: join(root, 'server'), projectRoot: root, target: mac, parse })).toBeUndefined()
  expect(readFileSync(join(root, 'server/compile.mjs'), 'utf-8')).toBe('import "./index.mjs";\n')
  expect(existsSync(join(root, 'compile'))).toBe(false)
})

test('a traced app is compiled from a copy whose imports of a package reach its shim', () => {
  const { server, project } = tracedSharp(scratch())
  const tree = writeCompileTree({ serverDir: server, projectRoot: project, target: mac, parse })

  expect(tree && 'hash' in tree && tree.hash).toMatch(/^[0-9a-f]{16}$/)

  const compile = join(server, '..', 'compile')
  expect(readFileSync(join(server, 'compile.mjs'), 'utf-8')).toContain('import "../compile/compile.mjs"')
  expect(readFileSync(join(compile, '_ssr/rsc.mjs'), 'utf-8')).toContain('import sharp from "sharp"')
  // The shim loads the entry that exists - the trace kept the import one.
  expect(readFileSync(join(compile, 'node_modules/sharp/index.cjs'), 'utf-8')).toContain('("sharp/dist/index.mjs")')
  // Inside the tree, sharp's own import of detect-libc is a path.
  expect(readFileSync(join(compile, '.native/node_modules/sharp/dist/index.mjs'), 'utf-8')).toContain(
    'from "../../detect-libc/lib/detect-libc.js"',
  )
  expect(readFileSync(join(compile, 'natives.mjs'), 'utf-8')).toContain('sharp-darwin-arm64/lib/sharp.node" with { type: "file" }')
  // Nothing the binary would never read from here.
  expect(existsSync(join(compile, 'node_modules/sharp/dist'))).toBe(false)
})

test('the hash is of the files: the same build gives the same one, a changed file a new one', () => {
  const { server, project } = tracedSharp(scratch())
  const hashOf = () => {
    writeFileSync(join(server, 'compile.mjs'), 'import "./index.mjs";\n')
    const tree = writeCompileTree({ serverDir: server, projectRoot: project, target: mac, parse })
    return tree && 'hash' in tree ? tree.hash : undefined
  }

  const first = hashOf()
  expect(hashOf()).toBe(first)

  writeFileSync(join(server, 'node_modules/@img/sharp-darwin-arm64/lib/sharp.node'), 'a new binary')
  expect(hashOf()).not.toBe(first)
})

/** The runtime as the binary has it, over a tree of one package, run in its own process. */
function runtime(root: string, hash: string) {
  write(root, {
    'bin/pkg-src/index.js': 'module.exports = require("dep")',
    'bin/pkg-src/package.json': '{"name":"pkg"}',
    'bin/dep-src/index.js': 'module.exports = "dep loaded"',
    'bin/dep-src/package.json': '{"name":"dep","main":"index.js"}',
    'bin/natives.mjs':
      `export const hash = ${JSON.stringify(hash)};\n` +
      `export const files = [` +
      `["pkg/index.js", ${JSON.stringify(join(root, 'bin/pkg-src/index.js'))}],` +
      `["pkg/package.json", ${JSON.stringify(join(root, 'bin/pkg-src/package.json'))}],` +
      `["dep/index.js", ${JSON.stringify(join(root, 'bin/dep-src/index.js'))}],` +
      `["dep/package.json", ${JSON.stringify(join(root, 'bin/dep-src/package.json'))}]];\n`,
    'bin/rsc-kit-native.cjs': RUNTIME_SOURCE,
    'bin/run.cjs': 'console.log(require("./rsc-kit-native.cjs")("pkg/index.js")); process.exit(0)',
  })

  return (dir: string) =>
    Bun.spawnSync(['bun', join(root, 'bin/run.cjs')], { env: { ...process.env, RSC_KIT_RUNTIME_DIR: dir } })
}

test('the first start writes the tree, and a later one finds it and writes nothing', () => {
  const root = scratch()
  const run = runtime(root, 'a'.repeat(16))
  const dir = join(root, 'rt')

  const first = run(dir)
  expect(first.stdout.toString()).toContain('wrote 4 files')
  // The package, and the dependency it requires by name.
  expect(first.stdout.toString()).toContain('dep loaded')

  const second = run(dir)
  expect(second.stdout.toString()).not.toContain('wrote')
  expect(second.stdout.toString()).toContain('dep loaded')
  expect(readdirSync(dir)).toEqual(['a'.repeat(16)])
})

test('a start clears trees nothing has touched for a day, and leaves recent ones', () => {
  const root = scratch()
  const run = runtime(root, 'a'.repeat(16))
  const dir = join(root, 'rt')
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
  const recent = new Date(Date.now() - 60 * 1000)

  write(dir, {
    [`${'b'.repeat(16)}/x`]: '',
    [`${'c'.repeat(16)}/x`]: '',
    [`.${'d'.repeat(16)}-abc/x`]: '',
    'not-ours/x': '',
  })
  utimesSync(join(dir, 'b'.repeat(16)), old, old)
  utimesSync(join(dir, `.${'d'.repeat(16)}-abc`), old, old)
  utimesSync(join(dir, 'not-ours'), old, old)
  utimesSync(join(dir, 'c'.repeat(16)), recent, recent)

  run(dir)

  expect(readdirSync(dir).sort()).toEqual(['a'.repeat(16), 'c'.repeat(16), 'not-ours'])
})

test("a directory it cannot write to says so, and names the variable", () => {
  const root = scratch()
  const run = runtime(root, 'a'.repeat(16))

  writeFileSync(join(root, 'a-file'), '')

  const failed = run(join(root, 'a-file', 'rt'))
  expect(failed.exitCode).not.toBe(0)
  expect(failed.stderr.toString()).toContain('Set RSC_KIT_RUNTIME_DIR to a directory it can write to')
})
