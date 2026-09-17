// Reading built output off a disk.
//
// Kept apart from the host on purpose: it is the only part of serving an RSC
// app that assumes a filesystem, and plenty of places to run one do not have
// one. Nothing in `@rsc-kit/core/host` imports this module, so a bundle for a
// host without a filesystem carries no reference to `node:fs` at all.
//
// Assets are not here any more — Nitro publishes and serves those. What is
// left is the prerendered output: written by the build, read by the server it
// generates, and copied by a static export.

import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Read what the prerenderer wrote, from a directory.
 *
 * Missing is an answer, not an error: a partial prerender is a valid state,
 * and anything not found here is rendered on demand instead.
 */
export function prerenderedFrom(dir: string) {
  /**
   * What is on disk, listed once.
   *
   * A miss used to be a thrown ENOENT, and misses are the common case: the
   * host asks for `{url}.html`, then `{url}.ppr.html`, then the route's
   * pattern — so every request to a page served by a pattern shell threw and
   * caught two exceptions before finding anything. Measured at 3,000 req/s
   * against 28,000 for the same page read from memory.
   *
   * Only existence is cached, never contents: a file that is there is still
   * read on every request, so a redeploy that rewrites one is picked up. What
   * a running server will not notice is a page appearing that was not there at
   * boot — which is a build artefact, and the build has finished.
   */
  let present: Promise<Set<string>> | null = null

  const listing = async (): Promise<Set<string>> => {
    present ??= readdir(dir, { recursive: true })
      .then((names) => new Set(names.map((n) => String(n).replace(/\\/g, '/'))))
      // An absent directory is an empty one: a partial prerender is a valid
      // state, and everything falls through to being rendered.
      .catch(() => new Set<string>())

    return await present
  }

  return async (name: string): Promise<string | null> => {
    if (name.includes('..')) return null

    if (!(await listing()).has(name)) return null

    try {
      return await readFile(join(dir, name), 'utf-8')
    } catch {
      return null
    }
  }
}

/**
 * The same reader, for a directory whose absolute path is not known until the
 * server runs.
 *
 * Nitro bundles the generated entry to a different depth depending on the
 * preset — `.output/server/index.mjs` for one, `.output/server/_ssr/rsc.mjs`
 * for another — so neither a fixed relative path nor a path baked in at build
 * time survives: the first is wrong for half the presets, and the second stops
 * being true the moment `.output/` is copied to the machine that serves it.
 *
 * So the caller passes its own `import.meta.url` and the directory is found by
 * walking up from it. A few levels, bounded, and resolved once.
 *
 *   prerendered: prerenderedBeside(import.meta.url, 'rsc-static')
 *
 * Not finding it is a valid state and not an error: nothing was frozen, or
 * this host has no filesystem to have frozen it on. Every page renders live,
 * which is what happens today everywhere.
 */
export function prerenderedBeside(moduleUrl: string, dirName: string, levels = 4) {
  let reader: Promise<(name: string) => Promise<string | null>> | null = null

  const resolveDir = async (): Promise<(name: string) => Promise<string | null>> => {
    let dir: string | null = null

    try {
      const { fileURLToPath } = await import('node:url')

      dir = dirname(fileURLToPath(moduleUrl))
    } catch {
      // No filesystem, or no file: url to speak of. The inline module below
      // is the only place the pages can be.
    }

    if (dir !== null) {
      for (let i = 0; i <= levels; i++) {
        const candidate = join(dir, ...Array(i).fill('..'), dirName)

        try {
          await readdir(candidate)

          return prerenderedFrom(candidate)
        } catch {
          // Not at this level. Keep walking.
        }
      }
    }

    const inline = await inlinePrerendered(moduleUrl, `${dirName}-inline.mjs`, levels)

    return inline ? async (name) => inline[name] ?? null : async () => null
  }

  return async (name: string): Promise<string | null> => {
    reader ??= resolveDir()

    return await (await reader)(name)
  }
}

/**
 * The frozen pages as one module, for a runtime with no filesystem.
 *
 * A Worker cannot readdir. Its modules are what wrangler uploaded, and a
 * sibling .mjs beside the bundle is one of them - so the build writes every
 * stored file into `rsc-static-inline.mjs` as strings, and this walks up from
 * the caller the way the disk reader does, importing rather than reading.
 * The specifier is computed, and marked for the bundler to leave alone: at
 * bundle time the file does not exist yet, because it is written by the
 * prerender that runs the bundle.
 *
 * Two forms of the specifier, because runtimes disagree. workerd resolves a
 * relative string against the importing module's name and refuses a url;
 * Node and Bun want the url, since a relative string would resolve against
 * this file rather than the caller's.
 */
async function inlinePrerendered(
  moduleUrl: string,
  fileName: string,
  levels: number,
): Promise<Record<string, string> | null> {
  for (let i = 0; i <= levels; i++) {
    const relative = './' + '../'.repeat(i) + fileName

    for (const specifier of [relative, safeUrl(relative, moduleUrl)]) {
      if (!specifier) continue

      try {
        const loaded = (await import(/* @vite-ignore */ specifier)) as { default?: Record<string, string> }

        if (loaded.default && typeof loaded.default === 'object') return loaded.default
      } catch {
        // Not there, or not at this level.
      }
    }
  }

  return null
}

function safeUrl(relative: string, base: string): string | null {
  try {
    return new URL(relative, base).href
  } catch {
    return null
  }
}

/** The name the build writes the inline module under, beside the stored pages' directory. */
export function inlineModuleName(dirName: string): string {
  return `${dirName}-inline.mjs`
}

/**
 * Every stored file under `dir`, as the source of the inline module.
 * Strings only: a frozen page, its flight payload, its meta, an api answer.
 */
export async function inlineModuleSource(dir: string): Promise<string> {
  const { readdir: list, readFile: read } = await import('node:fs/promises')
  const entries: Record<string, string> = {}

  const walk = async (sub: string): Promise<void> => {
    for (const entry of await list(join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name

      if (entry.isDirectory()) await walk(rel)
      else entries[rel] = await read(join(dir, rel), 'utf-8')
    }
  }

  await walk('')

  return (
    '// @generated by the RSC build: the stored pages, for a runtime with no filesystem.\n' +
    'export default ' +
    JSON.stringify(entries) +
    '\n'
  )
}

function contentTypeOf(pathname: string): string {
  if (pathname.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.map')) return 'application/json; charset=utf-8'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.woff2')) return 'font/woff2'

  return 'application/octet-stream'
}

/**
 * Write build output into a directory.
 *
 * The sink `prerender` and `exportSite` take. Names are relative and may
 * contain directories — `docs/index.html` — so each one's parent is created
 * as it goes.
 */
export function writeTo(dir: string): ((name: string, contents: string) => Promise<void>) & { dir: string } {
  const write = async (name: string, contents: string): Promise<void> => {
    const path = join(dir, name)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }

  // Where it wrote, for a caller that has to read it back. The embeddable
  // module has to list these files, and being told the directory a second time
  // is a second place for it to be wrong.
  return Object.assign(write, { dir })
}

/**
 * Copy the built browser bundle into an exported site.
 *
 * Separate from the export itself because copying a tree of files is a
 * filesystem operation by nature — a deploy that uploads them to a bucket
 * has its own way to do that, and passes its own callback instead.
 */
export function copyAssets(from: string, to: string, url = '/assets/') {
  return async (): Promise<void> => {
    const at = url.replace(/^\/+|\/+$/g, '')

    if (at === '') return

    const target = join(to, at)

    await mkdir(dirname(target), { recursive: true })
    await cp(from, target, { recursive: true })
  }
}
