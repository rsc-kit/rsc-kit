// Reading built output off a disk.
//
// Kept apart from the host on purpose: it is the only part of serving an RSC
// app that assumes a filesystem, and plenty of places to run one do not have
// a filesystem. A Worker reads its assets from a binding, a Deno Deploy app
// from KV, a CDN from itself. Those hosts pass their own readers and never
// load this module — and because nothing in `@rsc-router/core/host` imports it, a
// bundle for one of them contains no reference to `node:fs` at all.
//
//   import { createRscHandler } from '@rsc-router/core/host'
//   import { assetsFrom, prerenderedFrom } from '@rsc-router/core/files'
//
//   createRscHandler({
//     engine,
//     assets: assetsFrom('./build/public'),
//     prerendered: prerenderedFrom('./build/static'),
//   })

import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Serve built browser assets out of the build's public directory.
 *
 * `dir` is the browser's root, not the asset folder: a request for
 * /assets/x.js reads <dir>/assets/x.js. Stripping the prefix instead reads
 * <dir>/x.js, which is a 404 for every asset and a page that renders and then
 * never hydrates — nothing logs, because the failed request is the browser's.
 *
 * In production these belong in front of the application, on whatever already
 * serves static files. This exists so a development server and a single-file
 * binary do not each write it.
 */
export function assetsFrom(dir: string, prefix = '/assets/') {
  return async (pathname: string): Promise<Response | null> => {
    if (!pathname.startsWith(prefix)) return null

    // No traversal out of the asset directory, whatever the url claims.
    if (pathname.includes('..')) return null

    try {
      const bytes = await readFile(join(dir, pathname))

      return new Response(bytes, {
        headers: {
          'Content-Type': contentTypeOf(pathname),
          // Content-hashed by the build, so this is safe and is the difference
          // between a warm navigation and a cold one.
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    } catch {
      return null
    }
  }
}

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
