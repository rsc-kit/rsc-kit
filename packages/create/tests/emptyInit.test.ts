// init in a directory with nothing to add to: it starts the app there.
//
// "No package.json here - run bun create" sent someone who had just made an
// empty repository to a second command that does the same thing into a new
// subdirectory. An empty directory, or a fresh clone of an empty repository,
// is a place to start; one holding unrelated files is refused, since
// scaffolding over them is not what anyone asked for.

import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isFreshDirectory } from '../src/init'

const INIT = join(import.meta.dir, '../src/init.ts')

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'init-empty-'))

  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents)

  return dir
}

function init(dir: string, ...args: string[]) {
  const script = `const { runInit } = await import(${JSON.stringify(INIT)}); await runInit(process.argv.slice(2))`

  return spawnSync('bun', ['-e', script, '--', ...args], { cwd: dir, encoding: 'utf-8' })
}

describe('what counts as nothing to add to', () => {
  test('an empty directory, or what a new repository starts with', () => {
    expect(isFreshDirectory(dirWith({}))).toBe(true)
    expect(isFreshDirectory(dirWith({ 'README.md': '# x', LICENSE: 'MIT', '.gitignore': 'node_modules\n' }))).toBe(true)
  })

  test('not a directory with anything else in it', () => {
    expect(isFreshDirectory(dirWith({ 'notes.txt': 'hello' }))).toBe(false)
    expect(isFreshDirectory(dirWith({ 'README.md': '# x', 'index.html': '<p>' }))).toBe(false)
  })
})

describe('init where there is nothing to add to', () => {
  test('an empty directory becomes the app, named after the directory', () => {
    const dir = dirWith({})
    const run = init(dir, '--yes', '--host=bun', '--no-install', '--no-git')

    expect(run.status).toBe(0)
    expect(existsSync(join(dir, 'src/app/page.tsx'))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name).toMatch(/^init-empty-/)
  }, 60_000)

  test('a fresh clone keeps its README, and its .gitignore gains what the app needs ignored', () => {
    // GitHub writes a .gitignore; skipping ours left .env - with its
    // generated secret - one `git add .` from being committed.
    const dir = dirWith({ 'README.md': '# Mine\n', '.gitignore': 'node_modules\n' })
    const run = init(dir, '--yes', '--host=bun', '--no-install', '--no-git', '--backend=http://127.0.0.1:8080')
    const ignore = readFileSync(join(dir, '.gitignore'), 'utf-8').split('\n')

    expect(run.status).toBe(0)
    expect(readFileSync(join(dir, 'README.md'), 'utf-8')).toBe('# Mine\n')
    expect(ignore).toContain('.env')
    expect(ignore).toContain('.output')
    expect(ignore.filter((line) => line === 'node_modules')).toHaveLength(1)
  }, 60_000)

  test('a directory of unrelated files is refused, not scaffolded over', () => {
    const dir = dirWith({ 'notes.txt': 'hello' })
    const run = init(dir, '--yes', '--host=bun')

    expect(run.status).toBe(1)
    expect(run.stdout).toContain('Nothing here to add to')
    expect(existsSync(join(dir, 'package.json'))).toBe(false)
  }, 60_000)
})
