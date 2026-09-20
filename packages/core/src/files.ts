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
   * Contents are cached for the life of the process. A build's output does
   * not change under a running server - a deploy restarts it, and a server
   * that outlived a rebuild would be serving a stale engine against new
   * pages anyway - so the first read is the only one. Under load the same
   * page used to be opened, read and closed thousands of times a second,
   * which a profile showed as the one cost on a stored page that was ours
   * rather than React's. Capped by bytes, so a site with more pages than
   * memory holds the hot ones and re-reads the rest.
   */
  let present: Promise<Set<string>> | null = null

  const CONTENT_CAP_BYTES = 64 * 1024 * 1024
  const contents = new Map<string, string>()
  let held = 0

  const remember = (name: string, text: string): void => {
    const size = text.length * 2

    if (size > CONTENT_CAP_BYTES / 4) return

    while (held + size > CONTENT_CAP_BYTES && contents.size > 0) {
      const oldest = contents.keys().next().value as string
      held -= contents.get(oldest)!.length * 2
      contents.delete(oldest)
    }

    contents.set(name, text)
    held += size
  }

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

    const cached = contents.get(name)

    if (cached !== undefined) return cached

    try {
      const text = await readFile(join(dir, name), 'utf-8')

      remember(name, text)

      return text
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
/**
 * Where a compiled binary puts the frozen pages.
 *
 * `bun build --compile` embeds what is imported statically and nothing a
 * computed import names, so the walk below finds no directory and no
 * module inside a binary. The build writes `compile.mjs` beside the
 * server: it imports the inline module by name - which embeds it - and
 * hands the pages over here before importing the server. Shared as a
 * global under a registered symbol, because the wrapper and this module
 * are bundled apart.
 */
export const EMBEDDED_PAGES = Symbol.for('rsc-kit.embedded-pages')

function embeddedPages(): Record<string, string> | null {
  const pages = (globalThis as Record<symbol, unknown>)[EMBEDDED_PAGES]

  return pages && typeof pages === 'object' ? (pages as Record<string, string>) : null
}

export function prerenderedBeside(moduleUrl: string, dirName: string, levels = 4) {
  let reader: Promise<(name: string) => Promise<string | null>> | null = null

  const resolveDir = async (): Promise<(name: string) => Promise<string | null>> => {
    const embedded = embeddedPages()

    if (embedded) return async (name) => embedded[name] ?? null

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

/**
 * The entry a binary is compiled from, written beside the server.
 *
 * Two static imports, in this order: the inline module first - evaluating
 * it hands the pages over - and the server second. A module's imports are
 * evaluated in order, before its own body, so the pages are in place before
 * the server's first line runs. Bun embeds both.
 *
 * Static rather than `await import()`: a top-level await is what made Bun
 * skip `--bytecode` for this entry, silently, byte for byte - and a port
 * whose other Nitro app compiled with it asked why this one could not.
 * `bun build --compile --bytecode .output/server/compile.mjs` works now.
 */
export function compileEntrySource(dirName: string): string {
  return (
    '// The entry to compile into one binary: bun build --compile .output/server/compile.mjs\n' +
    '//\n' +
    '// A binary carries what is imported by name. The server reads its frozen pages\n' +
    '// through a computed import, which a compile cannot see - imported here, they\n' +
    '// travel inside the binary and are handed to the server before it starts.\n' +
    '// Two static imports in this order, and no top-level await: imports evaluate\n' +
    '// in order, and an await here is what stopped --bytecode from applying.\n' +
    `import "./${inlineModuleName(dirName)}";\n` +
    'import "./index.mjs";\n'
  )
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

  // Exported for the Worker, which imports it when the directory is not
  // there, and handed over as a global for the binary, whose compile entry
  // imports it first for exactly this side effect. The same data either way.
  return (
    '// @generated by the RSC build: the stored pages, for a runtime with no filesystem.\n' +
    'const pages = ' +
    JSON.stringify(entries) +
    ';\n' +
    'globalThis[Symbol.for("rsc-kit.embedded-pages")] = pages;\n' +
    'export default pages;\n'
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
