#!/usr/bin/env node
// rsc-kit — the commands an app runs, and the door into an existing project.
//
// Two entry points exist on purpose. `bun create rsc-kit@latest my-app` scaffolds a
// new one; this is what someone types when they already have a project, and it
// has to work with nothing installed — which is why `init` delegates to
// create-rsc-kit rather than reimplementing it. One implementation, two doors.

import { argv, exit, stdout } from 'node:process'

const HELP = `
  rsc-kit — React Server Components on any JavaScript server

  Usage
    rsc-kit init [options]        add it to the project in this directory

  Run \`rsc-kit init --help\` for what it takes. Freezing pages is part of
  \`vite build\` and has no command: it needs the bundle the build just wrote,
  which is somewhere only the build knows.
  Starting a new app instead: bun create rsc-kit@latest my-app
`

// Same trap as the scaffolder: `bunx rsc-kit init` reuses whatever bunx
// downloaded first, and this is the door a Laravel project comes through — so
// it is the one most likely to be years-old and silent about it. Started here
// so the request overlaps the work, and read at the end.
const { checkForNewer, notifyIfStale, selfVersion } = await import('create-rsc-kit/stale')
const staleCheck = checkForNewer('rsc-kit', selfVersion(import.meta.url))

const [command, ...rest] = argv.slice(2)

if (!command || command === '--help' || command === '-h') {
  stdout.write(HELP)
  exit(command ? 0 : 1)
}

if (command === 'init') {
  // The scaffolder owns every template already; init is the mode of it that
  // writes into a project rather than an empty directory.
  const { runInit } = await import('create-rsc-kit/init')

  await runInit(rest)
  await notifyIfStale(staleCheck, 'bunx rsc-kit@latest init')
} else {
  stdout.write(`\n  Not an rsc-kit command: ${command}\n${HELP}`)
  exit(1)
}
