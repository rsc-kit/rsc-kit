/**
 * Native packages inside a compiled binary.
 *
 * A package with a native binary - sharp, a database driver - is left external
 * by the build, and Nitro traces it into .output/server/node_modules. A server
 * run from that directory loads it from there. `bun build --compile` cannot:
 * it bundles the package's JavaScript, and the package then looks for its
 * `.node` file beside a module that is no longer on disk, so the binary starts
 * and dies on the first import of it.
 *
 * So a binary carries those packages as files, and writes them to disk the
 * first time it runs: to `<RSC_KIT_RUNTIME_DIR>/<hash>/node_modules`, the
 * binary's own directory when the variable is unset. The hash is of the files,
 * so two versions sharing one directory during a deploy never share a tree,
 * and a second start of the same version writes nothing.
 *
 * Inside a binary Bun resolves no package by name, from anywhere - not from
 * the bundle, and not from a file on disk that the bundle loaded. Neither a
 * `Module._resolveFilename` hook nor a runtime plugin sees an ESM import there.
 * So every name is resolved here, at build time, while the tree is on disk:
 * each import and require of a package in the tree is rewritten to a relative
 * path, and the app's own imports of one go through a shim that loads it from
 * the written tree. The hook stays, for a require whose name is computed.
 *
 * An app with nothing traced gets none of this: its compile entry is the one
 * it always had.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isBuiltin } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'

/** Where the compile tree is written, beside .output/server. */
export const COMPILE_TREE_DIR = 'compile'

/** A platform a binary runs on, in the terms a package.json's os, cpu and libc use. */
export interface Platform {
  os: string
  arch: string
  /** Only on linux. */
  libc?: 'glibc' | 'musl'
}

/** The platform this process runs on. */
export function hostPlatform(): Platform {
  if (process.platform !== 'linux') return { os: process.platform, arch: process.arch }

  const header = (process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header

  return { os: 'linux', arch: process.arch, libc: header && !header.glibcVersionRuntime ? 'musl' : 'glibc' }
}

/**
 * The platform a compile script targets: `--target=bun-linux-x64-musl`, or
 * the build machine's own when it names none. `baseline` and `modern` are CPU
 * levels of the same arch, and change nothing a package declares.
 */
export function targetPlatform(script: string | undefined, host: Platform = hostPlatform()): Platform {
  const target = script?.match(/--target[=\s]+["']?bun-([a-z0-9]+)-([a-z0-9]+)((?:-[a-z]+)*)/)

  if (!target) return host

  const [, os, arch, modifiers] = target
  const platform = os === 'windows' ? 'win32' : os

  if (platform !== 'linux') return { os: platform, arch }

  return { os: platform, arch, libc: modifiers.includes('-musl') ? 'musl' : 'glibc' }
}

export function describePlatform(platform: Platform): string {
  return `${platform.os}-${platform.arch}${platform.libc ? ` (${platform.libc})` : ''}`
}

interface PackageJson {
  name?: string
  version?: string
  main?: string
  exports?: unknown
  os?: string[]
  cpu?: string[]
  libc?: string[]
  optionalDependencies?: Record<string, string>
}

/** npm's rule for os, cpu and libc: a list of allowed values, or of `!`-negated ones. */
function allows(list: string[] | undefined, value: string | undefined): boolean {
  if (!list || list.length === 0 || value === undefined) return true

  const denied = list.filter((v) => v.startsWith('!')).map((v) => v.slice(1))
  const allowed = list.filter((v) => !v.startsWith('!'))

  if (denied.includes(value)) return false

  return allowed.length === 0 || allowed.includes(value)
}

export function runsOn(pkg: PackageJson, platform: Platform): boolean {
  return allows(pkg.os, platform.os) && allows(pkg.cpu, platform.arch) && allows(pkg.libc, platform.libc)
}

function readJson(path: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PackageJson
  } catch {
    return undefined
  }
}

/** A directory, following a symlink: Nitro links each traced package into node_modules from a store beside it. */
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Every package directory under a node_modules, scoped and nested ones included. */
function packageDirs(nodeModules: string): string[] {
  if (!isDir(nodeModules)) return []

  const dirs: string[] = []

  for (const name of readdirSync(nodeModules)) {
    const path = join(nodeModules, name)

    if (name.startsWith('.') || !isDir(path)) continue

    if (name.startsWith('@')) {
      for (const scoped of readdirSync(path)) {
        if (isDir(join(path, scoped))) dirs.push(join(path, scoped), ...packageDirs(join(path, scoped, 'node_modules')))
      }
    } else {
      dirs.push(path, ...packageDirs(join(path, 'node_modules')))
    }
  }

  return dirs
}

/** Every file under a directory, following symlinks, and not into a package's own node_modules when `packageOnly`. */
function files(dir: string, packageOnly = false): string[] {
  const found: string[] = []

  const walk = (sub: string) => {
    for (const name of readdirSync(join(dir, sub))) {
      const rel = sub ? `${sub}/${name}` : name

      if (packageOnly && name === 'node_modules') continue
      if (isDir(join(dir, rel))) walk(rel)
      else if (existsSync(join(dir, rel))) found.push(rel)
    }
  }

  walk('')

  return found.sort()
}

/**
 * A platform in a package's name: `darwin-arm64`, `linuxmusl-x64`,
 * `linux-x64-gnu`. Packages that ship one binary per platform name each one
 * this way, which is how the one for another platform is found.
 */
const PLATFORM_IN_NAME = /(darwin|linux|linuxmusl|win32|freebsd|android)-(x64|arm64|arm|ia32|ppc64|riscv64|s390x)(-(?:gnu|musl|msvc|gnueabihf|musleabihf))?/

function nameFor(name: string, platform: Platform): string | undefined {
  const found = name.match(PLATFORM_IN_NAME)

  if (!found) return undefined

  const [token, os, , suffix] = found
  const musl = platform.libc === 'musl'
  let replacement: string

  if (suffix) {
    // napi-rs: linux-x64-gnu / linux-x64-musl, darwin-arm64, win32-x64-msvc.
    const libc = platform.os === 'linux' ? (musl ? '-musl' : '-gnu') : platform.os === 'win32' ? '-msvc' : ''
    replacement = `${platform.os}-${platform.arch}${libc}`
  } else {
    // sharp: linux-x64 / linuxmusl-x64.
    replacement = `${platform.os === 'linux' && musl ? 'linuxmusl' : platform.os}-${platform.arch}`
  }

  return os === undefined ? undefined : name.replace(token, replacement)
}

/**
 * The package as it was installed, rather than as Nitro traced it. The trace
 * copies the files the server's imports reach, and only those: an import's
 * entry and not a require's, and not a file read at a path the tracer cannot
 * work out. A package written to disk whole finds whatever it looks for
 * beside its own code.
 */
function installedCopy(pkg: PackageJson | undefined, projectRoot: string): string | undefined {
  if (!pkg?.name) return undefined

  const candidates = [
    join(projectRoot, 'node_modules', pkg.name),
    // Bun's isolated store.
    join(projectRoot, 'node_modules', '.bun', `${pkg.name.replace('/', '+')}@${pkg.version}`, 'node_modules', pkg.name),
  ]

  return candidates.find((dir) => {
    const found = readJson(join(dir, 'package.json'))
    return found !== undefined && found.name === pkg.name && found.version === pkg.version
  })
}

export interface MissingPackage {
  name: string
  version?: string
}

export interface NativeSet {
  /** Package directory (relative to the tree's node_modules) to the directory its files are read from. */
  packages: Map<string, string>
  missing: MissingPackage[]
}

/**
 * The packages a binary for `target` needs: what Nitro traced, with each
 * package built for the build machine swapped for the one built for the
 * target. Nitro traces what is installed and loads on this machine, so a Mac
 * compiling for linux-x64 traced darwin binaries; the linux ones are found
 * beside them in the project's node_modules, or reported as missing.
 */
export function nativeSet(serverNodeModules: string, projectRoot: string, target: Platform, named: readonly string[] = []): NativeSet {
  const packages = new Map<string, string>()
  const missing: MissingPackage[] = []
  const traced = packageDirs(serverNodeModules)
  const optional = new Map<string, string>()

  for (const dir of traced) {
    for (const [name, version] of Object.entries(readJson(join(dir, 'package.json'))?.optionalDependencies ?? {})) {
      optional.set(name, version)
    }
  }

  for (const dir of traced) {
    const rel = relative(serverNodeModules, dir).split(sep).join('/')
    const pkg = readJson(join(dir, 'package.json'))

    if (!pkg || runsOn(pkg, target)) {
      packages.set(rel, installedCopy(pkg, projectRoot) ?? dir)
      continue
    }

    const name = pkg.name ?? rel
    const wanted = nameFor(name, target)

    // A platform package with no counterpart for the target - fsevents, say,
    // which only exists on macOS - is one the package itself does without.
    if (!wanted || !optional.has(wanted)) continue

    const installed = [join(projectRoot, 'node_modules', wanted), join(dir, '..', '..', wanted)].find((candidate) =>
      existsSync(join(candidate, 'package.json')),
    )
    const found = installed && readJson(join(installed, 'package.json'))

    if (installed && found && runsOn(found, target)) {
      packages.set(rel.slice(0, rel.length - name.length) + wanted, installed)
    } else {
      missing.push({ name: wanted, version: optional.get(wanted) })
    }
  }

  return { packages: onDisk(packages, named), missing }
}

/**
 * The packages that have to be on disk, out of all Nitro traced: one with a
 * `.node` or `.wasm`, or built for one platform; one that depends on such a
 * package, since it finds it from its own location; what those depend on, so
 * their imports resolve beside them; and any the app names in
 * serverExternalPackages, whose author said it reads its own files. The rest
 * - a polyfill, tslib - Bun bundles as it always did.
 */
function onDisk(packages: Map<string, string>, named: readonly string[]): Map<string, string> {
  const info = new Map(
    [...packages].map(([rel, dir]) => {
      const pkg = readJson(join(dir, 'package.json')) ?? {}
      const deps = Object.keys({ ...(pkg as { dependencies?: object }).dependencies, ...pkg.optionalDependencies, ...(pkg as { peerDependencies?: object }).peerDependencies })
      const native = !!(pkg.os || pkg.cpu) || files(dir, true).some((file) => /\.(node|wasm)$/.test(file))

      return [rel, { name: pkg.name ?? rel, deps, native }] as const
    }),
  )
  const disk = new Set([...info].filter(([, p]) => p.native || named.includes(p.name)).map(([rel]) => rel))
  const names = () => new Set([...disk].map((rel) => info.get(rel)!.name))

  for (let grew = true; grew; ) {
    grew = false
    const onDiskNames = names()
    for (const [rel, p] of info) {
      if (!disk.has(rel) && p.deps.some((dep) => onDiskNames.has(dep))) {
        disk.add(rel)
        grew = true
      }
    }
  }

  for (let grew = true; grew; ) {
    grew = false
    const wanted = new Set([...disk].flatMap((rel) => info.get(rel)!.deps))
    for (const [rel, p] of info) {
      if (!disk.has(rel) && wanted.has(p.name)) {
        disk.add(rel)
        grew = true
      }
    }
  }

  return new Map([...packages].filter(([rel]) => disk.has(rel)))
}

export function missingMessage(missing: MissingPackage[], target: Platform, host: Platform): string {
  return (
    `[rsc-kit] The binary is compiled for ${describePlatform(target)}, and these native packages for it are not installed:\n\n` +
    missing.map((m) => `  ${m.name}${m.version ? `@${m.version}` : ''}`).join('\n') +
    '\n\n' +
    `Install them for that platform, then compile again:\n\n` +
    `  bun install ${[...new Set([host.os, target.os])].map((os) => `--os=${os}`).join(' ')} ${[...new Set([host.arch, target.arch])].map((cpu) => `--cpu=${cpu}`).join(' ')}\n\n` +
    `This machine's own stay installed beside them, since the build loads them here.\n` +
    `Compiled from this machine's packages instead, the binary would start and crash on the first import of one.`
  )
}

/** The entry a package exports for `sub` ('.' or './x'), under the conditions an import or a require uses. */
function entryOf(pkgDir: string, sub: string, conditions: readonly string[], exists: (path: string) => boolean): string | undefined {
  const pkg = readJson(join(pkgDir, 'package.json'))

  if (!pkg) return undefined

  const pick = (target: unknown): string | undefined => {
    if (typeof target === 'string') return exists(join(pkgDir, target)) ? target : undefined
    if (Array.isArray(target)) {
      for (const item of target) {
        const found = pick(item)
        if (found) return found
      }
      return undefined
    }
    if (target && typeof target === 'object') {
      for (const condition of conditions) {
        if (condition in target) {
          const found = pick((target as Record<string, unknown>)[condition])
          if (found) return found
        }
      }
    }
    return undefined
  }

  const exported = pkg.exports

  if (exported !== undefined && exported !== null) {
    const keys = typeof exported === 'object' && !Array.isArray(exported) ? Object.keys(exported) : []
    const isMap = keys.length > 0 && keys.every((key) => key.startsWith('.'))

    if (!isMap) return sub === '.' ? pick(exported) : undefined

    const map = exported as Record<string, unknown>

    if (sub in map) return pick(map[sub])

    // A pattern: "./*": "./dist/*.js".
    for (const key of keys) {
      const star = key.indexOf('*')
      if (star === -1) continue

      const before = key.slice(0, star)
      const after = key.slice(star + 1)

      if (sub.startsWith(before) && sub.endsWith(after)) {
        const middle = sub.slice(before.length, sub.length - after.length)
        const target = JSON.parse(JSON.stringify(map[key]).replaceAll('*', middle)) as unknown
        return pick(target)
      }
    }

    return undefined
  }

  const candidates =
    sub === '.'
      ? [pkg.main, pkg.main && `${pkg.main}.js`, pkg.main && `${pkg.main}/index.js`, 'index.js']
      : [sub, `${sub}.js`, `${sub}.json`, `${sub}/index.js`]

  return candidates.find((candidate): candidate is string => !!candidate && exists(join(pkgDir, candidate)))
}

const IMPORT_CONDITIONS = ['bun', 'node', 'import', 'module', 'default'] as const
const REQUIRE_CONDITIONS = ['bun', 'node', 'require', 'default'] as const

/** The file a package specifier names, looked up the way Node walks node_modules from `fromDir`. */
function resolveInTree(
  specifier: string,
  fromDir: string,
  treeRoot: string,
  kind: 'import' | 'require',
  exists: (path: string) => boolean,
): string | undefined {
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  const sub = '.' + specifier.slice(name.length)

  for (let dir = fromDir; dir.startsWith(treeRoot); dir = dirname(dir)) {
    const pkgDir = join(dir, 'node_modules', name)

    if (exists(join(pkgDir, 'package.json'))) {
      const entry = entryOf(pkgDir, sub, kind === 'import' ? IMPORT_CONDITIONS : REQUIRE_CONDITIONS, exists)
      return entry && join(pkgDir, entry)
    }

    if (dir === treeRoot) break
  }

  return undefined
}

type Node = { type: string; start: number; end: number; [key: string]: unknown }

function isBare(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':') && !isBuiltin(specifier)
}

/**
 * Every package name in a module's imports and requires, rewritten to the
 * relative path of the file it resolves to inside the tree. A name the tree
 * does not have - a branch for another platform, an optional peer - is left
 * as it is. A file the parser cannot read is left whole; its requires reach
 * the hook at runtime.
 */
export function rewriteSpecifiers(
  code: string,
  file: string,
  treeRoot: string,
  parse: (code: string) => unknown,
  exists: (path: string) => boolean = existsSync,
): string {
  let ast: unknown

  try {
    ast = parse(code)
  } catch {
    return code
  }

  const edits: { start: number; end: number; text: string }[] = []

  const rewrite = (literal: unknown, kind: 'import' | 'require') => {
    const node = literal as Node | undefined

    if (!node || node.type !== 'Literal' || typeof node.value !== 'string' || !isBare(node.value)) return

    const resolved = resolveInTree(node.value, dirname(file), treeRoot, kind, exists)

    if (!resolved) return

    let path = relative(dirname(file), resolved).split(sep).join('/')
    if (!path.startsWith('.')) path = `./${path}`

    edits.push({ start: node.start, end: node.end, text: JSON.stringify(path) })
  }

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }

    if (!value || typeof value !== 'object') return

    const node = value as Node

    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
      case 'ImportExpression':
        rewrite(node.source, 'import')
        break
      case 'CallExpression': {
        const callee = node.callee as Node & { name?: string; object?: Node & { name?: string }; property?: Node & { name?: string } }
        const args = node.arguments as unknown[]
        const isRequire =
          (callee.type === 'Identifier' && callee.name === 'require') ||
          (callee.type === 'MemberExpression' && callee.object?.name === 'require' && callee.property?.name === 'resolve')

        if (isRequire && args.length > 0) rewrite(args[0], 'require')
        break
      }
    }

    for (const key in node) {
      if (key !== 'type' && key !== 'start' && key !== 'end') visit(node[key])
    }
  }

  visit(ast)

  if (edits.length === 0) return code

  edits.sort((a, b) => b.start - a.start)

  let out = code
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)

  return out
}

/**
 * What the binary runs before the first import of a native package: write the
 * tree if this version has not, then answer each shim's require from it.
 *
 * Extraction is into a temporary directory renamed into place, so a tree that
 * exists is a whole one: two copies starting at once each write their own,
 * one rename wins, and the other discards its copy. A running copy touches its
 * tree hourly, and a start removes the trees of other versions that nothing
 * has touched for a day - never its own, and never one a running copy of
 * another version is still using.
 */
export const RUNTIME_SOURCE = `'use strict'
const { hash, files } = require('./natives.mjs')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const HOUR = 60 * 60 * 1000
const STALE = 24 * HOUR

let base

function prepare() {
  const root = process.env.RSC_KIT_RUNTIME_DIR ? path.resolve(process.env.RSC_KIT_RUNTIME_DIR) : path.dirname(process.execPath)
  const dir = path.join(root, hash)

  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(root, { recursive: true })
      const tmp = fs.mkdtempSync(path.join(root, '.' + hash + '-'))
      for (const [rel, src] of files) {
        const to = path.join(tmp, 'node_modules', rel)
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.writeFileSync(to, fs.readFileSync(src))
      }
      try {
        fs.renameSync(tmp, dir)
        console.log('[rsc-kit] native packages: wrote ' + files.length + ' files to ' + dir)
      } catch (error) {
        fs.rmSync(tmp, { recursive: true, force: true })
        if (!fs.existsSync(dir)) throw error
      }
    } catch (error) {
      error.message =
        '[rsc-kit] the binary could not write its native packages to ' + root + ': ' + error.message +
        '. Set RSC_KIT_RUNTIME_DIR to a directory it can write to.'
      throw error
    }
  }

  const touch = () => { try { const now = new Date(); fs.utimesSync(dir, now, now) } catch {} }
  touch()
  setInterval(touch, HOUR).unref()
  sweep(root, path.basename(dir))

  base = path.join(dir, 'node_modules')

  // A require whose name is computed - require(name) - was not rewritten at
  // build time, and the binary's resolver cannot find it on disk. Answered
  // from the tree, for files inside it only.
  const resolve = Module._resolveFilename
  Module._resolveFilename = function (request, parent, ...rest) {
    try {
      return resolve.call(this, request, parent, ...rest)
    } catch (error) {
      const from = parent && parent.filename
      if (!from || !from.startsWith(dir) || request.startsWith('.') || request.startsWith('/') || Module.isBuiltin(request)) throw error
      const found = lookup(request, path.dirname(from))
      if (!found) throw error
      return found
    }
  }
}

function sweep(root, current) {
  let entries
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return }
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === current) continue
    const isTree = /^[0-9a-f]{16}$/.test(entry.name)
    const isPartial = /^\\.[0-9a-f]{16}-/.test(entry.name)
    if (!isTree && !isPartial) continue
    try {
      const age = now - fs.statSync(path.join(root, entry.name)).mtimeMs
      if (age > (isTree ? STALE : HOUR)) fs.rmSync(path.join(root, entry.name), { recursive: true, force: true })
    } catch {}
  }
}

function lookup(request, fromDir) {
  const parts = request.split('/')
  const name = request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  const sub = request.slice(name.length)
  for (let dir = fromDir; dir.startsWith(base) || dir === path.dirname(base); dir = path.dirname(dir)) {
    const pkgDir = path.join(dir, 'node_modules', name)
    if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
      if (sub) return path.join(pkgDir, sub)
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
      return path.join(pkgDir, pkg.main || 'index.js')
    }
    if (dir === path.dirname(base)) break
  }
}

module.exports = function load(entry) {
  if (!base) prepare()
  const loaded = require(path.join(base, entry))
  // A package with only an ES module: required, it is a namespace, which an
  // import of the shim would otherwise take as a CommonJS module's exports.
  if (Object.prototype.toString.call(loaded) === '[object Module]') return { __esModule: true, ...loaded }
  return loaded
}
`

export interface CompileTree {
  hash: string
  files: number
  packages: string[]
}

/**
 * Write the compile tree for a server whose build traced external packages,
 * and point compile.mjs at it. Returns undefined, and touches nothing, when
 * there is nothing traced.
 *
 * The tree is a copy of the server with each traced package replaced by a
 * shim, so `bun build --compile` bundles the shim and embeds the package's
 * files: the server's own chunks import packages by name, and Bun resolves a
 * name from the importing file's location, so the copy is what makes those
 * names land on the shims rather than on the real packages beside the server.
 */
export function writeCompileTree(options: {
  serverDir: string
  projectRoot: string
  target: Platform
  parse: (code: string) => unknown
  /** serverExternalPackages, which go to disk whether or not they have a binary. */
  named?: readonly string[]
}): CompileTree | { missing: MissingPackage[] } | undefined {
  const { serverDir, projectRoot, target, parse, named = [] } = options
  const serverNodeModules = join(serverDir, 'node_modules')
  const compileEntry = join(serverDir, 'compile.mjs')

  if (!existsSync(compileEntry) || packageDirs(serverNodeModules).length === 0) return undefined

  const { packages, missing } = nativeSet(serverNodeModules, projectRoot, target, named)

  if (missing.length > 0) return { missing }
  if (packages.size === 0) return undefined

  const tree = join(dirname(serverDir), COMPILE_TREE_DIR)
  const embedded = join(tree, '.native', 'node_modules')

  rmSync(tree, { recursive: true, force: true })

  // The server, without the stored pages (the inline module carries them).
  // Its node_modules too, links as they are, so a package that stays bundled
  // is found exactly where it was; the ones going to disk are replaced by
  // shims below.
  cpSync(serverDir, tree, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) => {
      const rel = relative(serverDir, path).split(sep).join('/')
      return rel !== 'rsc-static' && !rel.startsWith('rsc-static/')
    },
  })

  // Each package intact, so a file it reads beside its own code - a .wasm, a
  // data file, its package.json - is where it looks.
  for (const [rel, from] of packages) {
    cpSync(from, join(embedded, rel), {
      recursive: true,
      dereference: true,
      filter: (path) => !relative(from, path).split(sep).includes('node_modules'),
    })
  }

  const list = files(embedded)
  const hasher = createHash('sha256')

  for (const rel of list) {
    const path = join(embedded, rel)

    if (/\.(c|m)?js$/.test(rel)) {
      const code = readFileSync(path, 'utf-8')
      const rewritten = rewriteSpecifiers(code, path, dirname(embedded), parse)
      if (rewritten !== code) writeFileSync(path, rewritten)
    }

    hasher.update(rel)
    hasher.update('\0')
    hasher.update(readFileSync(path))
  }

  const hash = hasher.digest('hex').slice(0, 16)
  const tops = [...packages.keys()].filter((rel) => !rel.includes('/node_modules/'))

  // What the app's chunks import by name. The entry each one loads is looked
  // up now, so the runtime only joins a path - the require entry, since the
  // shim is a require: an import of a CommonJS module's default is the whole
  // module, and of an ES module's namespace is the namespace.
  for (const name of tops) {
    const entry =
      resolveInTree(name, dirname(embedded), dirname(embedded), 'require', existsSync) ??
      resolveInTree(name, dirname(embedded), dirname(embedded), 'import', existsSync)
    const shimDir = join(tree, 'node_modules', name)
    const runtime = relative(shimDir, join(tree, 'rsc-kit-native.cjs')).split(sep).join('/')

    rmSync(shimDir, { recursive: true, force: true })
    mkdirSync(shimDir, { recursive: true })
    writeFileSync(join(shimDir, 'package.json'), JSON.stringify({ name, main: 'index.cjs' }) + '\n')
    writeFileSync(
      join(shimDir, 'index.cjs'),
      entry
        ? `module.exports = require(${JSON.stringify(runtime)})(${JSON.stringify(relative(embedded, entry).split(sep).join('/'))})\n`
        : `throw new Error(${JSON.stringify(`[rsc-kit] ${name} has no entry the binary can load`)})\n`,
    )
  }

  writeFileSync(
    join(tree, 'natives.mjs'),
    '// Every file of the packages that run from disk, embedded by importing it as a file.\n' +
      list.map((rel, i) => `import f${i} from ${JSON.stringify(`./.native/node_modules/${rel}`)} with { type: "file" };`).join('\n') +
      `\nexport const hash = ${JSON.stringify(hash)};\n` +
      `export const files = [\n${list.map((rel, i) => `  [${JSON.stringify(rel)}, f${i}]`).join(',\n')}\n];\n`,
  )
  writeFileSync(join(tree, 'rsc-kit-native.cjs'), RUNTIME_SOURCE)

  writeFileSync(
    compileEntry,
    '// The entry to compile into one binary. This app has native packages, so the\n' +
      `// entry is a copy of the server whose imports of them load them from disk:\n` +
      `// ${tops.join(', ')}.\n` +
      `import "../${COMPILE_TREE_DIR}/compile.mjs";\n`,
  )

  return { hash, files: list.length, packages: tops }
}

/** The size of a directory, for the build's one line about it. */
export function sizeOf(dir: string): number {
  return files(dir).reduce((sum, rel) => sum + statSync(join(dir, rel)).size, 0)
}
