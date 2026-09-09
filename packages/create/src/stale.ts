// Telling someone their scaffolder is old, because nothing else will.
//
// `bun create rsc-kit` is `bunx create-rsc-kit`, and `bunx rsc-kit init` is the
// same shape — bunx reuses the copy it downloaded the first time. A machine
// that ran either once keeps using that version however many releases later,
// which here meant scaffolding from one two releases old: offering hosts that
// had been removed, and writing a config the current plugin refuses.
//
// Naming the tag is what makes bunx revalidate. Measured against an older
// build planted in the cache slot:
//
//   bun create rsc-kit             stale
//   bunx create-rsc-kit            stale
//   bunx rsc-kit init              stale
//   bun create rsc-kit@latest      fresh
//   bunx create-rsc-kit@latest     fresh
//   npx create-rsc-kit@latest      fresh
//
// So every instruction this project publishes names it. That is the fix, and
// this is for the copies already cached, which no wording can reach. Printing
// a version alone would not do it either — nobody knows v0.5.0 is two behind
// unless something says so.
//
// create-next-app does this with the `update-check` package. Not here: both
// packages are installed by bunx before they can do anything, so a dependency
// is latency every user waits through, which is the same reason the prompts
// are written against readline. It is one request to one url.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stdout } from 'node:process'

import { bold, cyan, dim } from './prompt.js'

/**
 * The calling package's version, read from the manifest above it.
 *
 * Read rather than baked in, because the version is only written at publish
 * time. The caller passes its own `import.meta.url` so this answers for
 * whichever package asked — `create-rsc-kit` and `rsc-kit` both do.
 */
export function selfVersion(moduleUrl: string): string {
  try {
    const path = join(dirname(fileURLToPath(moduleUrl)), '../package.json')

    return (JSON.parse(readFileSync(path, 'utf-8')) as { version: string }).version
  } catch {
    return ''
  }
}

/**
 * Ask the registry what `latest` is. Null when there is nothing to say.
 *
 * Start it before the first prompt and read it after the last: a person
 * answering questions is slower than a registry, so it costs nothing. Failure
 * is silence — offline, behind a proxy, or a registry that is down are all no
 * notice rather than a tool that hangs or will not run.
 */
export function checkForNewer(pkg: string, mine: string): Promise<string | null> {
  // Unknown is not stale. An unreadable manifest answers '', and comparing
  // against that would report every run as behind.
  if (!mine) return Promise.resolve(null)

  return (async () => {
    const response = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: AbortSignal.timeout(3000),
      headers: { accept: 'application/json' },
    })

    if (!response.ok) return null

    const latest = ((await response.json()) as { version?: string }).version

    return latest && latest !== mine ? latest : null
  })().catch(() => null)
}

/** Say it, and say the way out — which is the tag, not the version. */
export async function notifyIfStale(check: Promise<string | null>, command: string): Promise<void> {
  const latest = await check

  if (!latest) return

  stdout.write(
    `${dim('A newer release is out:')} ${bold(`v${latest}`)}${dim('.')}\n` +
      `${dim('bunx reuses the copy it downloaded first. Name the tag and it fetches:')}\n\n` +
      `  ${cyan(command)}\n\n`,
  )
}
