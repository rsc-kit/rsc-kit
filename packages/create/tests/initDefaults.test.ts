/**
 * What init assumes when nobody says.
 *
 * init was made for adding RSC to an existing JavaScript app: it has a package
 * manager and a lockfile of its own, so init installs nothing, and it has its
 * own styling, so Tailwind is not pushed on it. A Go service has neither - no
 * package.json at all, so init writes the first - and there is nothing of the
 * project's to respect: it is a new frontend, and it gets create's defaults.
 */
import { describe, expect, test } from 'bun:test'
import { initDefaults } from '../src/init'

const project = (over: { createdPackageJson: boolean; hasTailwind: boolean }) => over

describe('init defaults', () => {
  test('a project with no package.json (a Go service): Tailwind, and install', () => {
    expect(initDefaults(project({ createdPackageJson: true, hasTailwind: false }))).toEqual({ tailwind: true, install: true })
  })

  test('an existing JavaScript project: no Tailwind pushed on it, nothing installed', () => {
    expect(initDefaults(project({ createdPackageJson: false, hasTailwind: false }))).toEqual({ tailwind: false, install: false })
  })

  test('an existing project that already has Tailwind keeps it, and still installs nothing', () => {
    expect(initDefaults(project({ createdPackageJson: false, hasTailwind: true }))).toEqual({ tailwind: true, install: false })
  })
})
