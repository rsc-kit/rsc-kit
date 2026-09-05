#!/usr/bin/env node
//
// The three packages release in lockstep, and `rsc-kit` pins the other two.
// So a version bump is never one number: miss the cross-dependency and the
// CLI ships depending on a version of the engine that does not exist yet,
// which fails at install time for everyone and never at build time for us.
//
//   node scripts/versions.mjs 0.1.1   set all three, and the cross-deps
//   node scripts/versions.mjs --check verify they agree (used by CI)

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = ['core', 'create', 'cli']
const INTERNAL = ['@rsc-kit/core', 'create-rsc-kit', 'rsc-kit']

const read = (p) => JSON.parse(readFileSync(join(root, 'packages', p, 'package.json'), 'utf8'))
const write = (p, d) =>
  writeFileSync(join(root, 'packages', p, 'package.json'), JSON.stringify(d, null, 2) + '\n')

const arg = process.argv[2]
if (!arg) {
  console.error('usage: versions.mjs <version> | --check')
  process.exit(2)
}

if (arg === '--check') {
  const versions = new Map(PACKAGES.map((p) => [read(p).name, read(p).version]))
  const distinct = new Set(versions.values())
  const problems = []

  if (distinct.size !== 1) {
    problems.push(`versions disagree: ${[...versions].map(([n, v]) => `${n}@${v}`).join(', ')}`)
  }

  const version = versions.get('@rsc-kit/core')
  for (const p of PACKAGES) {
    const pkg = read(p)
    for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
      if (!INTERNAL.includes(dep)) continue
      if (range !== `^${version}`) {
        problems.push(`${pkg.name} depends on ${dep}@${range}, expected ^${version}`)
      }
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`error: ${p}`)
    process.exit(1)
  }

  console.log(version)
  process.exit(0)
}

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(arg)) {
  console.error(`error: "${arg}" is not a version`)
  process.exit(2)
}

for (const p of PACKAGES) {
  const pkg = read(p)
  pkg.version = arg
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (INTERNAL.includes(dep)) pkg.dependencies[dep] = `^${arg}`
  }
  write(p, pkg)
  console.log(`  ${pkg.name} -> ${arg}`)
}
