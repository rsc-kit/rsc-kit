#!/usr/bin/env bash
# Prove the package works the way it is published, not the way it is linked.
#
# The monorepo cannot show this on its own: node_modules/@rsc-kit/core is a
# workspace symlink resolving OUTSIDE node_modules, so Node happily strips
# types from the source. A real install does not, and refuses outright:
#
#   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
#
# which is why the package ships compiled JavaScript. Nothing in either test
# suite can catch a regression here — only packing and installing can.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cd "$root/packages/core"
tarball="$(npm pack --pack-destination "$work" --silent | tail -1)"

cd "$work"
printf '{ "name": "verify", "type": "module", "private": true }' > package.json
npm install --silent "$work/$tarball" react react-dom

cat > probe.mjs <<'PROBE'
const entries = ['host', 'files', 'prerender', 'export', 'routing', 'headers', 'redirect', 'revalidate', 'request', 'routes', 'action']
for (const name of entries) await import(`@rsc-kit/core/${name}`)
const { readFileSync } = await import('node:fs')
// A directive one line down is not a directive — it is an ignored string, and
// every client component silently becomes a server one.
for (const f of ['js/Link', 'js/Form', 'js/SegmentBoundary', 'js/RedirectBoundary']) {
  const first = readFileSync(`node_modules/@rsc-kit/core/dist/${f}.js`, 'utf8').split('\n')[0]
  if (!first.startsWith('"use client"')) throw new Error(`${f}: directive is not first — got ${first}`)
}
console.log('  every entry imports, client directives intact')
PROBE

echo "== Node =="
node probe.mjs
echo "== Bun =="
bun probe.mjs
