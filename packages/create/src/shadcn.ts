import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { stdout } from 'node:process'
import { bold, cyan, dim } from './prompt.js'

/**
 * Tell shadcn this is an RSC app: `"rsc": true` in components.json, so the
 * components it adds that need the browser start with "use client".
 *
 * Its own init sees a plain Vite project and writes false. Returns whether
 * the file was there to change.
 */
export function markRsc(path: string): boolean {
  let config: Record<string, unknown>

  try {
    config = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return false
  }

  if (config.rsc === true) return true

  config.rsc = true
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')

  return true
}

/**
 * The stylesheet components.json names, when the app never loads it: the
 * path as written, or null when it is the app's stylesheet or one that
 * stylesheet imports.
 *
 * shadcn writes its theme - the colours, the dark variant - to that file,
 * and `shadcn add` keeps writing there. In a Laravel app it found
 * resources/css/app.css, which only Blade's @vite loads; the pages were
 * styled by Tailwind and nothing else, and nothing said why.
 */
export function unloadedShadcnCss(dir: string, stylesheet: string): string | null {
  let named: unknown

  try {
    named = (JSON.parse(readFileSync(join(dir, 'components.json'), 'utf-8')) as { tailwind?: { css?: unknown } }).tailwind?.css
  } catch {
    return null
  }

  if (typeof named !== 'string' || named === '') return null

  const target = resolve(dir, named)
  const own = resolve(dir, stylesheet)

  if (target === own) return null

  const source = existsSync(own) ? readFileSync(own, 'utf-8') : ''

  for (const [, path] of source.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    if (path!.startsWith('.') && resolve(dirname(own), path!) === target) return null
  }

  return named
}

function warnUnloaded(dir: string, stylesheet: string | undefined): void {
  const named = stylesheet ? unloadedShadcnCss(dir, stylesheet) : null

  if (!named) return

  stdout.write(
    `\n${bold(`components.json names ${named}, which the app does not load.`)} shadcn's theme goes there.\n` +
      `  Import it from ${cyan(stylesheet!)}, or move it there and set ${cyan(`"css": "${stylesheet}"`)} in components.json.\n`,
  )
}

/**
 * shadcn/ui for an rsc-kit app, new or existing.
 *
 * Already set up - a components.json is there, from a Next app say - it is
 * only marked RSC. Otherwise shadcn's own init runs, once dependencies are
 * installed, and its result is marked: its CLI sees a plain Vite project and
 * writes "rsc": false, so a dialog or a dropdown it adds later has no
 * "use client" and fails to render as a server component.
 *
 * Its questions are its own - the component library, the style - so it asks
 * them in this terminal, unless the run was told to ask nothing, in which
 * case it takes its defaults too.
 */
export function setUpShadcn(o: { dir: string; host: string; unattended: boolean; installed: boolean; stylesheet?: string }): void {
  const config = join(o.dir, 'components.json')

  if (existsSync(config)) {
    markRsc(config)
    stdout.write(`\n  ${cyan('~')} components.json  ${dim('— "rsc": true, so shadcn adds "use client" where it is needed')}\n`)
    warnUnloaded(o.dir, o.stylesheet)

    return
  }

  const [runner, ...prefix] = o.host === 'node' ? ['npx', '--yes'] : ['bunx', '--bun']
  const init = [...prefix, 'shadcn@latest', 'init', ...(o.unattended ? ['--defaults', '--yes'] : [])]

  if (!o.installed || spawnSync(runner!, init, { cwd: o.dir, stdio: 'inherit' }).status !== 0) {
    stdout.write(
      `\n${bold('shadcn/ui is not set up.')} Once dependencies are installed:\n` +
        `  ${cyan([runner, ...init].join(' '))}\n` +
        `  then set ${cyan('"rsc": true')} in components.json\n`,
    )

    return
  }

  markRsc(config)
  warnUnloaded(o.dir, o.stylesheet)
}
