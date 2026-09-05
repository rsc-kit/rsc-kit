// Putting the build output inside the binary.
//
// `bun build --compile` bundles the JavaScript it can see and nothing else, so
// a compiled server renders pages and then 404s every stylesheet and every
// client chunk — the page arrives, unstyled, and never hydrates. Nothing warns:
// the server starts, the routes answer, and only the browser knows.
//
// Bun embeds a file when something imports it with `{ type: 'file' }`, so this
// writes a module that imports each one and hands back the readers the host
// already takes:
//
//     bun run embed        # after vite build && prerender
//     bun build --compile server.ts --outfile app
//
// The generated module is the only thing that has to exist at compile time.
// After that the binary carries the assets, the prerendered pages and the
// engine, and runs anywhere with nothing beside it.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export interface EmbedOptions {
  /** The browser build — what `assetsDir` pointed at. */
  assets?: string
  /** What the prerenderer wrote. */
  prerendered?: string
  /** Where to write the generated module. */
  out: string
  /** The url prefix assets are served under. */
  prefix?: string
}

/** Every file under a directory, as paths relative to it. */
function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return []

  const found: string[] = []

  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)

    if (statSync(abs).isDirectory()) {
      found.push(...walk(abs, base))
    } else {
      found.push(relative(base, abs).replace(/\\/g, '/'))
    }
  }

  return found
}

/**
 * Write the module that embeds the build.
 *
 * Returns what it found, so a build script can say so rather than producing a
 * binary that is quietly missing half of itself.
 */
export function writeEmbedModule(options: EmbedOptions): { assets: number; prerendered: number } {
  const prefix = options.prefix ?? '/assets/'
  const assetsDir = options.assets ? resolve(options.assets) : null
  const prerenderedDir = options.prerendered ? resolve(options.prerendered) : null

  const assetFiles = assetsDir ? walk(assetsDir) : []
  const pageFiles = prerenderedDir ? walk(prerenderedDir) : []

  const imports: string[] = []
  const assetEntries: string[] = []
  const pageEntries: string[] = []

  const outDir = dirname(resolve(options.out))
  // Relative to the generated module. An absolute path is only true on the
  // machine that wrote it, and a build that moves — a container, CI — would
  // compile a binary whose every asset points at somewhere that does not exist.
  const from = (abs: string) => {
    const rel = relative(outDir, abs).replace(/\\/g, '/')

    return rel.startsWith('.') ? rel : './' + rel
  }

  // Sorted, so the same input produces the same module and the same binary.
  assetFiles.sort().forEach((name, i) => {
    imports.push(`import a${i} from ${JSON.stringify(from(join(assetsDir!, name)))} with { type: 'file' }`)
    assetEntries.push(`  ${JSON.stringify(prefix + name)}: a${i},`)
  })

  pageFiles.sort().forEach((name, i) => {
    imports.push(`import p${i} from ${JSON.stringify(from(join(prerenderedDir!, name)))} with { type: 'file' }`)
    pageEntries.push(`  ${JSON.stringify(name)}: p${i},`)
  })

  const source = `// GENERATED — do not edit. Written by writeEmbedModule().
//
// Each import is what makes the file part of the binary. A path read at
// runtime would not be: bun build --compile follows imports, not strings.
${imports.join('\n')}

export const assetPaths: Record<string, string> = {
${assetEntries.join('\n')}
}

export const pagePaths: Record<string, string> = {
${pageEntries.join('\n')}
}

export const TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
}

/** The \`assets\` reader, served from inside the binary. */
export async function assets(pathname: string): Promise<Response | null> {
  const path = assetPaths[pathname]

  if (!path) return null

  // .stream() rather than the file itself: a Response implementation that does
  // not know what a BunFile is turns the body into the string "[object Blob]",
  // which serves a stylesheet that parses as nothing and reports 200.
  return new Response(Bun.file(path).stream(), {
    headers: {
      'Content-Type': TYPES[pathname.split('.').pop() ?? ''] ?? 'application/octet-stream',
      // Content-hashed by the build, so this is safe.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}

/** The \`prerendered\` reader, served from inside the binary. */
export async function prerendered(name: string): Promise<string | null> {
  const path = pagePaths[name]

  return path ? await Bun.file(path).text() : null
}
`

  mkdirSync(dirname(resolve(options.out)), { recursive: true })
  writeFileSync(resolve(options.out), source)

  return { assets: assetFiles.length, prerendered: pageFiles.length }
}
