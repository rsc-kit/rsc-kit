// Build a static site. Run after `bun run build:static`.
//
// Refuses unless every route is fully static: a static host runs nothing, so
// a shell here is a page that loads and stays empty.
import { prerender } from '@rsc-kit/core/prerender'
import { exportSite, NotExportable } from '@rsc-kit/core/export'
import { copyAssets, prerenderedFrom, writeTo } from '@rsc-kit/core/files'
import * as engine from './build/dist/rsc/index.js'

const results = await prerender({ engine, write: writeTo('./build/static') })

try {
  // #region export
  const { pages, refused } = await exportSite({
    results,
    read: prerenderedFrom('./build/static'),
    write: writeTo('./out'),
    manifest: engine.manifest(),
    assets: copyAssets('./build/public/assets', './out', '/assets/'),
    // A site with holes in it, for moving an app towards being exportable.
    force: process.argv.includes('--force'),
  })
  // #endregion

  console.log(`Exported ${pages} pages to ./out`)

  if (refused.length > 0) {
    console.log(`Left out ${refused.length}: ${refused.map((r) => r.url).join(', ')}`)
  }
} catch (error) {
  if (!(error instanceof NotExportable)) throw error

  console.error(error.message)
  process.exit(1)
}
