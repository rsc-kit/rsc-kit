// Whether a scaffold should create a repository.
//
// A new app scaffolded into a monorepo's apps/ got a repository of its own,
// nested and empty, and the monorepo then refused to add the directory: git
// reads a nested .git as a submodule with nothing in it. The new files belong
// to the repository that is already there.

import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { insideRepository } from '../src/git'

describe('a directory inside a repository', () => {
  test('is seen as such, however deep', () => {
    const root = mkdtempSync(join(tmpdir(), 'repo-'))

    spawnSync('git', ['init', '--quiet'], { cwd: root })
    mkdirSync(join(root, 'apps', 'web'), { recursive: true })

    expect(insideRepository(root)).toBe(true)
    expect(insideRepository(join(root, 'apps', 'web'))).toBe(true)
  })

  test('and one outside any is not', () => {
    // A temp directory is outside every repository - unless the machine's
    // temp dir sits inside one, which nothing here can help.
    const lone = mkdtempSync(join(tmpdir(), 'lone-'))

    expect(insideRepository(lone)).toBe(false)
  })
})
