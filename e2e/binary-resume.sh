#!/usr/bin/env bash
# A compiled binary resumes a partially prerendered page - checked on an app
# scaffolded the way a user gets one, because that is the shape that broke.
#
# A replay matches each slot by component name, and bun build --compile merges
# module scopes and renames what collides. On a fresh scaffold the engine's own
# PathnameProvider collided: the shell said <PathnameProvider>, the binary
# rendered <PathnameProvider2>, and every hole went to the browser. An app with
# a different shape bundles differently and may never collide - this one did,
# every time, until the names were pinned at build.
#
# Needs e2e/.core.tgz (bun run core).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'kill "${pid:-}" 2>/dev/null || true; rm -rf "$work"' EXIT

cd "$work"
bun "$here/../packages/create/src/index.ts" app --yes --host=bun --no-git --no-install >/dev/null
cd app
# The engine as a user installs it: packed, into node_modules.
sed -i.bak "s|\"@rsc-kit/core\": \"[^\"]*\"|\"@rsc-kit/core\": \"file:$here/.core.tgz\"|" package.json && rm package.json.bak
bun install >/dev/null

mkdir -p src/components/one src/components/two "src/app/shelf/[id]"
printf "'use client'\nexport function Label({ children }: { children: React.ReactNode }) { return <b>{children}</b> }\n" > src/components/one/Label.tsx
printf "'use client'\nexport function Label({ children }: { children: React.ReactNode }) { return <i>{children}</i> }\n" > src/components/two/Label.tsx
cat > "src/app/shelf/[id]/page.tsx" <<'PAGE'
import { Suspense } from 'react'
import { Label as One } from '@/components/one/Label'
import { Label as Two } from '@/components/two/Label'

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <p>Shelf {id}</p>
}

export default function Shelf({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main>
      <One>first</One>
      <Two>second</Two>
      <Suspense fallback={<span>loading</span>}>
        <Detail params={params} />
      </Suspense>
    </main>
  )
}
PAGE

bun run compile >/dev/null
PORT=4690 ./dist/app > server.log 2>&1 &
pid=$!
for _ in $(seq 1 50); do curl -sf -o /dev/null http://localhost:4690/ && break; sleep 0.2; done

failed=0
for id in 1 2 3; do
  html=$(curl -s "http://localhost:4690/shelf/$id")
  if ! grep -Eq "Shelf (<!-- -->)?$id" <<<"$html"; then
    echo "::error::/shelf/$id: the hole was not filled at the origin"
    failed=1
  fi
done

if grep -q "instead it rendered" server.log; then
  echo "::error::the binary refused the replay:"
  grep -oE "Expected the resume to render <[A-Za-z0-9_$]+> in this slot but instead it rendered <[A-Za-z0-9_$]+>" server.log | head -1
  failed=1
fi

[ "$failed" = 0 ] && echo "binary resume: holes filled at the origin, no mismatch"
exit "$failed"
