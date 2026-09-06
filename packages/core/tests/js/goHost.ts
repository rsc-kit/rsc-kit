// Shared setup for the Go-adapter tests.
//
// It exists to enforce one thing: a single built bundle, built once, for the
// whole suite. Client references live in a global registry keyed by id, so two
// @vitejs/plugin-rsc bundles alive in one process evict each other's
// components — and the failure surfaces in whichever file loads a bundle
// third, as "client reference not found" against a component it never
// mentions. Every Go test therefore shares this build and this path.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const packageRoot = join(import.meta.dir, '../..')

export const adapterDir = join(packageRoot, '../../adapters/go')
export const appDir = join(packageRoot, 'tests/fixtures/rsc-app')
// prerender.test.ts's directory, deliberately, and the whole point of this
// module: ONE bundle per process. Two @vitejs/plugin-rsc builds alive at once
// means two React copies and two client-reference registries, and the symptom
// lands in whichever file loses the race — a Link resolved out of the other
// bundle, rendering with a null ReactSharedInternals.H.
//
// Same app, same output path, so whichever file gets there first builds it and
// the rest import the module already in memory.
export const outDir = join(packageRoot, '.tmp/vite-test')
export const bundlePath = join(outDir, 'dist/rsc/index.js')

// happy-dom, registered by the DOM tests, replaces fetch and AbortController
// process-wide: its fetch blocks a plain-http request from a page it considers
// https, and its abort signal is one the runtime's own fetch will not accept.
// These tests exercise the round trip to Go; the timeout path is covered in
// hostCalls.test.ts against a stub, where no global is in the way.
export const realFetch = ((url: unknown, init: Record<string, unknown> = {}) =>
  Bun.fetch(url as string, { ...init, signal: undefined })) as unknown as typeof fetch

/** True when any source file is newer than the built bundle, or it is absent. */
function stale(): boolean {
  if (!existsSync(bundlePath)) return true

  const built = statSync(bundlePath).mtimeMs

  const newest = (dir: string): number => {
    let latest = 0

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // The build writes rsc-routes.d.ts and friends back into the source
      // directory, so counting them compares a build against its own output
      // and rebuilds every time.
      if (entry.isFile() && entry.name.startsWith('rsc-') && entry.name.endsWith('.d.ts')) continue

      const full = join(dir, entry.name)
      latest = Math.max(latest, entry.isDirectory() ? newest(full) : statSync(full).mtimeMs)
    }

    return latest
  }

  return newest(appDir) > built
}

let building: Promise<void> | null = null

/** Build the fixture app, once per process and only when it has changed. */
export function buildFixtureOnce(): Promise<void> {
  building ??= (async () => {
    if (!stale()) return

    const build = Bun.spawn(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        RSC_PROJECT_ROOT: packageRoot,
        RSC_SOURCE_DIR: appDir,
        RSC_OUT_DIR: outDir,
        RSC_ASSETS_DIR: join(outDir, 'public'),
        RSC_VITE_CONFIG: join(packageRoot, 'tests/fixtures/vite.rsc.config.mjs'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if ((await build.exited) !== 0) {
      throw new Error(`fixture build failed:\n${await new Response(build.stderr).text()}`)
    }
  })()

  return building
}

/**
 * Start the example Go host on an ephemeral port.
 *
 * It prints its address before it serves, so this is a handshake rather than a
 * sleep — no race, and no fixed delay to tune.
 */
export async function startGoHost(secret: string): Promise<{ address: string; kill: () => void }> {
  const workDir = mkdtempSync(join(tmpdir(), 'rsckit-go-'))
  const binary = join(workDir, 'hostserver')

  const built = Bun.spawnSync(['go', 'build', '-o', binary, './examples/hostserver'], {
    cwd: adapterDir,
    stderr: 'pipe',
  })

  if (built.exitCode !== 0) throw new Error(`go build failed: ${built.stderr.toString()}`)

  const server = Bun.spawn([binary, '-secret', secret, '-addr', '127.0.0.1:0'], { stdout: 'pipe', env: { ...process.env } })
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let banner = ''

  while (!banner.includes('\n')) {
    const { value, done } = await reader.read()
    if (done) break
    banner += decoder.decode(value, { stream: true })
  }

  reader.releaseLock()

  const address = banner.match(/listening on (\S+)/)?.[1]
  if (!address) throw new Error(`host server did not report an address: ${banner}`)

  return {
    address,
    kill: () => {
      server.kill()
      rmSync(workDir, { recursive: true, force: true })
    },
  }
}
