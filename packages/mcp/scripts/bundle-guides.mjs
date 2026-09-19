// Run after tsc: copies the docs guides into ./guides for read_guide.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bundleGuides } from '../dist/bundleGuides.js'

const pkg = dirname(dirname(fileURLToPath(import.meta.url)))
const repo = join(pkg, '..', '..')
const docs = join(repo, 'docs/src/content/docs')
const index = bundleGuides([docs, join(docs, 'guides'), join(docs, 'hosts')], join(pkg, 'guides'), repo)

console.log(`bundled ${index.length} guides`)
