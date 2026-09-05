#!/usr/bin/env node
// rsc-kit — the commands an app runs, and the door into an existing project.
//
// Two entry points exist on purpose. `bun create rsc-kit my-app` scaffolds a
// new one; this is what someone types when they already have a project, and it
// has to work with nothing installed — which is why `init` delegates to
// create-rsc-kit rather than reimplementing it. One implementation, two doors.

import { argv, exit, stdout } from 'node:process'

const HELP = `
  rsc-kit — React Server Components on any JavaScript server

  Usage
    rsc-kit init [options]        add it to the project in this directory
    rsc-kit prerender [options]   render every route once and store what it can

  Run \`rsc-kit <command> --help\` for what each takes.
  Starting a new app instead: bun create rsc-kit my-app
`

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
} else if (command === 'prerender') {
  const { runPrerender } = await import('@rsc-kit/core/cli')

  await runPrerender(rest)
} else {
  stdout.write(`\n  Not an rsc-kit command: ${command}\n${HELP}`)
  exit(1)
}
