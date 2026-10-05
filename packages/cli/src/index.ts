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
    rsc-kit init [options]        add it to the project in this directory,
                                  or start one here if the directory is empty
    rsc-kit typegen [--check]     write the route types without starting Vite,
                                  for a typecheck after a route was added;
                                  --check fails if committed ones are stale
    rsc-kit info [--json]         what a build of this app will produce, before
                                  building: a server (and its compile step and
                                  binary) or a static export (and its folder)
    rsc-kit agents                bring the rsc-kit section of AGENTS.md up to
                                  this version's rules; review it in git.
                                  An older section without a stamp needs
                                  --host and --source-dir (and --env, --pwa);
                                  a file with no section needs --replace

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
} else if (command === 'typegen') {
  // Loads the app's vite.config through the app's own Vite, so the types come
  // from the plugin version and options the app builds with.
  const { typegen } = await import('@rsc-kit/core/typegen')
  const check = rest.includes('--check')
  const stale = await typegen(process.cwd(), check)

  if (!check) {
    stdout.write('rsc-kit: route types written\n')
  } else if (stale.length === 0) {
    stdout.write('rsc-kit: generated files are current\n')
  } else {
    stdout.write(
      'rsc-kit typegen --check: these are committed and no longer what the backend and the routes produce:\n' +
        stale.map((f) => '  ' + f).join('\n') +
        '\nRun rsc-kit typegen and commit the result.\n',
    )
    exit(1)
  }
} else if (command === 'info') {
  // What a build of this app will produce, before building: for a deploy
  // that plans a binary or a folder first. The build confirms it in
  // .output/rsc-kit.json.
  const { appInfo } = await import('@rsc-kit/core/typegen')

  try {
    const info = await appInfo(process.cwd())

    if (rest.includes('--json')) stdout.write(JSON.stringify(info) + '\n')
    else stdout.write(Object.entries(info).map(([k, v]) => `  ${k}: ${v}`).join('\n') + '\n')
  } catch (error) {
    stdout.write(`\n  rsc-kit info: ${error instanceof Error ? error.message : String(error)}\n\n`)
    exit(1)
  }
} else if (command === 'agents') {
  // The rules an agent follows here, as this version writes them. Only the
  // marked section changes; the app's own instructions around it are left be.
  const { agentsFlags, updateAgents } = await import('create-rsc-kit/agents')
  const result = updateAgents(process.cwd(), agentsFlags(rest))

  if (result.kind === 'refused') {
    stdout.write(`\n  rsc-kit agents: ${result.reason}\n\n`)
    exit(1)
  }

  stdout.write(
    result.kind === 'current'
      ? `  AGENTS.md already has rsc-kit ${result.version}'s rules.\n`
      : `  AGENTS.md ${result.kind === 'wrote' ? 'written' : 'updated'} with rsc-kit ${result.version}'s rules. Review the change in git.\n`,
  )
} else {
  stdout.write(`\n  Not an rsc-kit command: ${command}\n${HELP}`)
  exit(1)
}
