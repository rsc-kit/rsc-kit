// Writing the whole site out as files, for a host that only serves files.
//
// Everything a server was doing has to have happened already, which makes the
// refusals the important part. A site exported with a route missing, or with a
// shell nothing will ever fill, does not fail at build time and does not fail
// on load — it serves a page that sits there, or a 404 for a url that worked
// yesterday. So anything that is not fully static stops the export and says
// which routes and why.
//
// Layout is a directory per route with an index inside it, so urls stay
// extensionless, and the Flight payload sits beside it under a filename the
// client was built to ask for.
//
//   out/index.html            /
//   out/index.rsc
//   out/docs/index.html       /docs
//   out/docs/index.rsc
//   out/assets/…              the browser bundle

import { pathKey } from './prerender.ts'
import type { PrerenderResult } from './prerender.ts'
import type { RouteManifest } from './manifest.ts'

export interface ExportOptions {
  /** What prerender() decided, so this can refuse what it cannot serve. */
  results: PrerenderResult[]
  /** Reads what prerender() wrote. `prerenderedFrom` in `@rsc-router/core/files`. */
  read: (name: string) => Promise<string | null> | string | null
  /**
   * Writes the site, keyed by its url path — `docs/index.html`, not an
   * absolute one. `writeTo` in `@rsc-router/core/files` puts those under a
   * directory; a deploy that uploads straight to a bucket writes keys.
   */
  write: (path: string, contents: string) => Promise<void> | void
  /** The route table, for what the build decided about payload urls. */
  manifest: RouteManifest
  /**
   * Brings the browser bundle along, if this export has to carry it.
   *
   * A callback rather than a directory pair: copying a tree of built files is
   * a filesystem operation by nature, and a deploy that uploads them has its
   * own tooling for it. `copyAssets` in `@rsc-router/core/files` does the local one.
   */
  assets?: () => Promise<void> | void
  /**
   * Export anyway, leaving out whatever is not static.
   *
   * The result is a site with holes in it, which is sometimes what you want
   * while moving an app towards being exportable. It is never the default,
   * because the holes are 404s at urls that worked before.
   */
  force?: boolean
}

export class NotExportable extends Error {
  constructor(public readonly refused: PrerenderResult[]) {
    super(
      'This site cannot be exported as it is. A static host runs nothing, so these routes have ' +
        'no way to finish rendering:\n\n' +
        refused.map((r) => `  ${r.url} — ${r.reason ?? describe(r.type)}`).join('\n') +
        '\n\nMake them static, or pass force to export the rest and leave these out.',
    )
    this.name = 'NotExportable'
  }
}

function describe(type: PrerenderResult['type']): string {
  if (type === 'ppr') {
    // Worth spelling out: a shell looks like a working page in the build
    // output, and on a static host it is a page that loads and stays empty.
    return 'only a shell was rendered, and nothing on a static host will fill it'
  }

  return type === 'dynamic' ? 'renders on demand' : 'failed to render'
}

export async function exportSite(options: ExportOptions): Promise<{ pages: number; refused: PrerenderResult[] }> {
  const { results, read, write, manifest, assets, force = false } = options
  const refused = results.filter((r) => r.type !== 'static')

  if (refused.length > 0 && !force) throw new NotExportable(refused)

  // The client has to ask for payloads by url, because a static host cannot
  // read the header that would otherwise select one. That is decided by the
  // build, so a site exported from a server build ships a client asking the
  // wrong way — every navigation silently falls back to a full page load.
  const payloadName = manifest.build?.payloadName

  if (!payloadName) {
    throw new Error(
      'This build was made for a server, so its client asks for payloads with a header rather ' +
        "than by url. Build with output: 'export' before exporting.",
    )
  }

  const copy = async (name: string, into: string) => {
    const contents = await read(name)

    // Missing where the results said it would be: the prerender output and the
    // results it returned disagree, which is not something to paper over with
    // a half-written site.
    if (contents === null) {
      throw new Error(`Nothing to export at ${name}. Prerender and export must read the same output.`)
    }

    await write(into, contents)
  }

  let pages = 0

  for (const result of results) {
    if (result.type !== 'static') continue

    const key = pathKey(result.url)
    // The root is the out dir itself; everything else is a directory with an
    // index, so /docs stays /docs rather than becoming /docs.html.
    const dir = key === 'index' ? '' : `${key}/`

    await copy(`${key}.html`, `${dir}index.html`)
    await copy(`${key}.flight`, `${dir}${payloadName}`)

    // One file per depth a client might already hold, addressed by name
    // because a file server cannot vary on a header. Without these every
    // navigation is a whole document, which replaces the root and unmounts
    // the pages retained behind it — so going back does not restore the form
    // you were filling in.
    for (let depth = 1; ; depth++) {
      const variant = await read(`${key}.seg${depth}.flight`)

      if (variant === null) break

      await write(`${dir}${payloadName.replace(/^index\./, `index.seg${depth}.`)}`, variant)
    }

    pages++
  }

  await assets?.()

  return { pages, refused }
}


