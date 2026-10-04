// The rsc-kit section of an AGENTS.md: the rules an agent follows in an
// rsc-kit app, kept current the way Laravel Boost keeps its guidelines.
//
// The package owns the section and regenerates it on request - `rsc-kit
// agents` - and git shows the change for review. Everything outside the
// markers is the app's and is never touched. The start marker records which
// version wrote the section and the options it was written for, so it can be
// written again exactly, and the dev server can say when it is behind.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Options } from './options.js'
import { selfVersion } from './stale.js'
import * as t from './templates.js'

const START = '<!-- rsc-kit:start'
const END = '<!-- rsc-kit:end -->'

/** What the rules depend on: the app's host, where its source is, and two choices made at scaffold. */
export interface AgentsOptions {
  host: Options['host']
  sourceDir: string
  env: boolean
  pwa: boolean
}

/** What a start marker records. */
export interface AgentsStamp extends AgentsOptions {
  version: string
}

/** The rules alone, for the options given: what the MCP server's `rules` tool answers. */
export function rules(o: AgentsOptions): string {
  return t.agents(o as Options).trim()
}

/** The section, between its markers, stamped with this version and the options. */
export function agentsSection(o: AgentsOptions): string {
  const stamp: AgentsStamp = {
    version: selfVersion(import.meta.url),
    host: o.host,
    sourceDir: o.sourceDir,
    env: Boolean(o.env),
    pwa: Boolean(o.pwa),
  }

  return `${START} ${JSON.stringify(stamp)} -->\n${rules(o)}\n${END}\n`
}

/** The stamp in an AGENTS.md's section; `{}` for a section from before stamps; null with no section. */
export function readStamp(text: string): Partial<AgentsStamp> | null {
  const at = text.indexOf(START)

  if (at === -1) return null

  const line = text.slice(at, text.indexOf('-->', at))
  const json = line.slice(START.length).trim()

  try {
    return json ? (JSON.parse(json) as Partial<AgentsStamp>) : {}
  } catch {
    return {}
  }
}

/** What `updateAgents` did, said once. */
export type AgentsResult =
  | { kind: 'wrote' | 'updated' | 'current'; path: string; version: string }
  | { kind: 'refused'; reason: string }

/**
 * Write the rsc-kit section of `dir`/AGENTS.md as this version writes it.
 *
 * The options come from the section's own stamp; `given` overrides them, and
 * is what an unstamped section from an older rsc-kit needs - the rules depend
 * on the host and the source directory, and they are not guessed. A file with
 * no section is only rewritten whole with `replace`, since then nothing
 * marks what is ours.
 */
export function updateAgents(dir: string, given: Partial<AgentsOptions> & { replace?: boolean } = {}): AgentsResult {
  const path = join(dir, 'AGENTS.md')
  const version = selfVersion(import.meta.url)
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
  const stamp = existing === null ? null : readStamp(existing)

  if (existing !== null && stamp === null && !given.replace) {
    return {
      kind: 'refused',
      reason:
        'AGENTS.md has no rsc-kit section to update. If it is the one rsc-kit wrote, run again with --replace ' +
        '(and --host and --source-dir) to rewrite it whole; git shows the change.',
    }
  }

  const o: Partial<AgentsOptions> = { ...stamp, ...given }

  if (!o.host || !o.sourceDir) {
    return {
      kind: 'refused',
      reason:
        'This AGENTS.md was written before rsc-kit recorded the options it was written for. ' +
        'Say them once: --host bun|node|worker|laravel --source-dir <dir> [--env] [--pwa].',
    }
  }

  const section = agentsSection({ host: o.host, sourceDir: o.sourceDir, env: Boolean(o.env), pwa: Boolean(o.pwa) })

  if (existing === null || (stamp === null && given.replace)) {
    writeFileSync(path, section)

    return { kind: 'wrote', path, version }
  }

  const start = existing.indexOf(START)
  const endAt = existing.indexOf(END, start)
  const before = existing.slice(0, start)
  const after = endAt === -1 ? '' : existing.slice(endAt + END.length).replace(/^\n/, '')
  const next = before + section + after

  if (next === existing) return { kind: 'current', path, version }

  writeFileSync(path, next)

  return { kind: 'updated', path, version }
}

/** Parse `rsc-kit agents` flags. */
export function agentsFlags(args: string[]): Partial<AgentsOptions> & { replace?: boolean } {
  const out: Partial<AgentsOptions> & { replace?: boolean } = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    const [flag, inline] = arg.split('=', 2) as [string, string | undefined]
    const value = () => inline ?? args[++i]

    if (flag === '--host') out.host = value() as AgentsOptions['host']
    else if (flag === '--source-dir') out.sourceDir = value()
    else if (flag === '--env') out.env = true
    else if (flag === '--pwa') out.pwa = true
    else if (flag === '--replace') out.replace = true
  }

  return out
}
