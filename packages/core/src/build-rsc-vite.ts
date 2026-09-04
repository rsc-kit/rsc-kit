// CLI behind `php artisan rsc:build`.
//
// The build itself lives in the Vite plugin (resources/vite.ts). This only
// decides which config Vite runs: the app's own vite.rsc.config if it has one,
// otherwise a minimal generated config that just uses the plugin. Either way
// Vite runs that config directly — nothing is merged on top of it.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isBun } from './runtime.ts'

const projectRoot = resolve(process.env.RSC_PROJECT_ROOT || process.cwd())
// Mirrors the plugin's default so the completion message names the
// directory the build actually wrote to.
const outDir = resolve(process.env.RSC_OUT_DIR || join(projectRoot, '.rsc'))

function log(...args: unknown[]): void {
  console.error('[laravel-rsc]', ...args)
}

/**
 * Config names, most specific first.
 *
 * A project's Vite config belongs at its root, so the ordinary case is the
 * root vite.config.* with rscRoutes() in its plugins. The vite.rsc.config.*
 * names exist for apps whose root config already drives a separate asset
 * pipeline — a Laravel app running laravel-vite-plugin, say, whose input,
 * outDir and manifest settings would otherwise apply to the RSC build too.
 */
export const USER_CONFIG_NAMES = [
  'vite.rsc.config.ts',
  'vite.rsc.config.mts',
  'vite.rsc.config.js',
  'vite.rsc.config.mjs',
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
] as const

/**
 * Find the Vite config for the RSC build.
 *
 * Nothing is generated: the build runs the project's own config, so what it
 * does is visible in the repo and anything the app wants in it — Tailwind, the
 * React Compiler, extra aliases — is declared there like any Vite project.
 */
export function findUserViteConfig(root: string): string | null {
  const explicit = process.env.RSC_VITE_CONFIG

  if (explicit) {
    const path = resolve(explicit)

    return existsSync(path) ? path : null
  }

  for (const name of USER_CONFIG_NAMES) {
    const path = join(root, name)
    if (existsSync(path)) return path
  }

  return null
}

/**
 * Packages the generated entries import directly, which the project must have.
 *
 * Without this the build fails deep inside the bundler — a missing
 * @vitejs/plugin-rsc surfaces as `Rolldown failed to resolve import
 * "@vitejs/plugin-rsc/rsc"` from a generated file the user never wrote.
 */
export const REQUIRED_PEERS = ['@vitejs/plugin-rsc', 'vite', 'react', 'react-dom'] as const

/**
 * Whether a package is installed in the project's node_modules, or a parent's.
 *
 * A plain directory walk rather than require.resolve: Bun resolves packages
 * from its global cache when a project has no node_modules at all, so the
 * resolver reports success for something the build will not find.
 */
export function isInstalled(root: string, name: string): boolean {
  let dir = resolve(root)

  while (true) {
    if (existsSync(join(dir, 'node_modules', name, 'package.json'))) return true

    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

/** Required packages the project does not have, in declaration order. */
export function missingPeers(root: string): string[] {
  return REQUIRED_PEERS.filter((name) => !isInstalled(root, name))
}

/** Shown when a project has no Vite config at all. */
export function missingConfigMessage(root: string): string {
  return [
    `No Vite config found in ${root}.`,
    '',
    'Create vite.config.ts:',
    '',
    "  import { rscRoutes } from 'laravel-rsc/vite'",
    "  import { defineConfig } from 'vite'",
    '',
    '  export default defineConfig({ plugins: [rscRoutes()] })',
    '',
    'If your root config already drives another asset pipeline (laravel-vite-plugin),',
    'put the RSC build in vite.rsc.config.ts instead so the two do not share settings.',
  ].join('\n')
}

/** This file's directory — import.meta.dir is Bun-only. */
function packageDir(): string {
  return resolve(new URL('.', import.meta.url).pathname)
}

function main(): void {
  const missing = missingPeers(projectRoot)

  if (missing.length > 0) {
    log(`Missing required package(s): ${missing.join(', ')}`)
    log(`Install them in ${projectRoot}:`)
    log('')
    log(`  npm install ${missing.join(' ')}`)
    log('')
    log('rscRoutes() composes @vitejs/plugin-rsc itself — it only has to be installed,')
    log('not added to your Vite config.')
    process.exit(1)
  }

  const configPath = findUserViteConfig(projectRoot)

  if (!configPath) {
    log(missingConfigMessage(projectRoot))
    process.exit(1)
  }

  log(`Using Vite config: ${configPath}`)

  const watch = process.env.RSC_WATCH === '1'

  // A development build keeps React's development bundle, so a failure reads
  // as "Maximum update depth exceeded" rather than "Minified React error #185"
  // and a link to look it up. Implied by watching, and available on its own for
  // reproducing something a production build only reports by number.
  const dev = watch || process.env.RSC_DEV === '1'

  const viteArgs = ['build', '--config', configPath]
  if (watch) viteArgs.push('--watch')
  // Vite's build command is production mode unless told otherwise, whatever
  // NODE_ENV says — without this the dev build still resolves React's
  // production entry.
  if (dev) viteArgs.push('--mode', 'development')

  // Under Bun, `bun x --bun vite` keeps Vite itself on the Bun runtime. Under
  // Node there is no such wrapper, so invoke the locally installed binary.
  const [command, args] = isBun
    ? [process.execPath, ['x', '--bun', 'vite', ...viteArgs]]
    : [join(projectRoot, 'node_modules/.bin/vite'), viteArgs]

  log(`Running vite build${watch ? ' --watch' : ''}${dev ? ' (development)' : ''}...`)

  const proc = spawnSync(command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: dev ? 'development' : 'production',
      // Vite stages the config through node_modules/.vite-temp, so the plugin
      // cannot locate this package from its own import.meta. Pass it through.
      RSC_PACKAGE_DIR: packageDir(),
    },
    stdio: 'inherit',
  })

  if (proc.status !== 0) {
    log('vite build failed')
    process.exit(proc.status ?? 1)
  }

  log(`Build complete → ${join(outDir, 'dist')}`)
}

// Run only when invoked directly, not when imported for its helpers.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main()
}
