// One Nitro: the one rsc-kit builds with. An older one is refused at build
// with what to change, and every pin in the repo says the same version, so a
// new app and the examples cannot drift from what the engine expects.

import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { NITRO_VERSION, nitroVersionProblem } from '../../src/vite'

const repo = join(import.meta.dir, '../../../..')

describe('the Nitro an app builds with', () => {
  test('is refused when older, with the version to pin', () => {
    expect(nitroVersionProblem('3.0.260903-beta')).toContain(`"nitro": "${NITRO_VERSION}"`)
    expect(nitroVersionProblem('2.11.0')).toContain('is older than')
    // npm sorts it below the dated ones; it builds, then 404s every route.
    expect(nitroVersionProblem('3.0.0')).toContain('is older than')
  })

  test('is taken when it is the one, or newer', () => {
    for (const version of [NITRO_VERSION, '3.0.261201-rc', '3.0.261201', '3.1.0', '4.0.0', undefined]) {
      expect(nitroVersionProblem(version)).toBeNull()
    }
  })

  test('is the one create-rsc-kit and every example pin', () => {
    expect(readFileSync(join(repo, 'packages/create/src/templates.ts'), 'utf-8')).toContain(`nitro: '${NITRO_VERSION}'`)

    for (const example of readdirSync(join(repo, 'examples'))) {
      const file = join(repo, 'examples', example, 'package.json')

      if (!existsSync(file)) continue

      const pkg = JSON.parse(readFileSync(file, 'utf-8'))
      const pinned = pkg.dependencies?.nitro ?? pkg.devDependencies?.nitro

      if (pinned) expect(pinned, example).toBe(NITRO_VERSION)
    }
  })
})
