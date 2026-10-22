#!/usr/bin/env bash
# A compiled binary loads native packages - sharp, heic-convert, and a package
# that reads a file beside its own code - run from a directory that is not the
# project, as a deploy runs it.
#
# Bun bundles a package's JavaScript into the binary, and sharp then looks for
# its .node file beside a module that is no longer on disk: the binary started
# and died on the first import. A binary now carries those packages and writes
# them to RSC_KIT_RUNTIME_DIR on its first start. This checks that it does,
# that a second start writes nothing, that two starting at once into one
# directory both come up, and that compiling for a platform whose packages
# are not installed fails the build.
#
# And prints what it costs: the binary's size with and without the packages,
# and how long each kind of start takes to answer.
#
# Needs e2e/.core.tgz (bun run core).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
# Every server started from the copy, and until each has gone: a timed start
# that found the last one still answering would time nothing.
stop() {
  pkill -f "$work/elsewhere/app" 2>/dev/null || true
  for _ in $(seq 1 100); do pgrep -f "$work/elsewhere/app" > /dev/null || return 0; sleep 0.05; done
  pkill -9 -f "$work/elsewhere/app" 2>/dev/null || true
}
trap 'stop; rm -rf "$work"' EXIT

failed=0
fail() { echo "::error::$1"; failed=1; }
now() { bun -e 'process.stdout.write(String(Math.round(performance.timeOrigin + performance.now())))'; }

# Starts the binary and prints the milliseconds until $3 answers 200.
start() {
  local port=$1 runtime=$2 url=$3 log=$4 began
  began=$(now)
  (cd "$work/elsewhere" && PORT=$port RSC_KIT_RUNTIME_DIR=$runtime exec "$work/elsewhere/app" > "$log" 2>&1) &
  for _ in $(seq 1 300); do
    curl -sf -o /dev/null "http://localhost:$port$url" && { echo $(($(now) - began)); return; }
    sleep 0.05
  done
  echo "timeout"
}

cd "$work"
bun "$here/../packages/create/src/index.ts" app --yes --host=bun --no-git --no-install >/dev/null
mkdir elsewhere
cd app
sed -i.bak "s|\"@rsc-kit/core\": \"[^\"]*\"|\"@rsc-kit/core\": \"file:$here/.core.tgz\"|" package.json && rm package.json.bak
bun install >/dev/null

# Without native packages: the compile entry is the one it always was.
bun run compile >/dev/null
[ -d .output/compile ] && fail "an app with no native packages got a compile tree"
plain_size=$(wc -c < dist/app)
cp dist/app ../elsewhere/app
# Once untimed, so the first exec of a new file - which macOS checks - is not
# in the time. Into a directory of its own, so the timed first start below
# still finds an empty one.
start 4710 "$work/rt-discard" / /dev/null > /dev/null
stop
plain_boot=$(start 4700 "$work/rt-plain" / "$work/plain.log")
stop
plain_warm=$(start 4711 "$work/rt-plain" / "$work/plain.log")
stop

cp -R "$here/fixtures/native/reads-beside" ../reads-beside
bun add sharp heic-convert ../reads-beside >/dev/null
sed -i.bak "s|rscKit({|rscKit({ serverExternalPackages: ['heic-convert', 'reads-beside'],|" vite.config.ts && rm vite.config.ts.bak
grep -q "serverExternalPackages" vite.config.ts || fail "could not add serverExternalPackages to the scaffold's vite.config.ts"

mkdir -p src/app/api/thumb src/app/api/heic src/app/api/beside
cat > src/modules.d.ts <<'TS'
declare module 'heic-convert' {
  export default function convert(options: { buffer: Buffer; format: 'PNG' | 'JPEG' }): Promise<ArrayBuffer>
}
declare module 'reads-beside' {
  export default function words(): string[]
}
TS
cat > src/app/api/thumb/route.ts <<'TS'
import sharp from 'sharp'

export async function GET() {
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).png().toBuffer()
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } })
}
TS
cat > src/app/api/heic/route.ts <<'TS'
import convert from 'heic-convert'

export async function POST(request: Request) {
  const png = await convert({ buffer: Buffer.from(await request.arrayBuffer()), format: 'PNG' })
  return new Response(png, { headers: { 'content-type': 'image/png' } })
}
TS
cat > src/app/api/beside/route.ts <<'TS'
import words from 'reads-beside'

export function GET() {
  return Response.json(words())
}
TS

bun run compile > "$work/compile.log" 2>&1 || { cat "$work/compile.log"; fail "the app with native packages did not compile"; exit 1; }
[ -d .output/compile ] || fail "an app with native packages got no compile tree"
native_size=$(wc -c < dist/app)
cp dist/app ../elsewhere/app
start 4712 "$work/rt-discard" /api/thumb /dev/null > /dev/null
stop

is_png() { curl -s "$1" "${@:2}" | head -c 4 | tail -c 3 | grep -q PNG; }

# First start, into an empty directory.
first_boot=$(start 4701 "$work/rt" /api/thumb "$work/first.log")
[ "$first_boot" = timeout ] && cut -c1-400 "$work/first.log" | head -30
is_png http://localhost:4701/api/thumb || fail "sharp did not answer a PNG"
is_png http://localhost:4701/api/heic --data-binary "@$here/fixtures/native/tiny.heic" || fail "heic-convert did not convert the HEIC"
[ "$(curl -s http://localhost:4701/api/beside)" = '["beside","its","code"]' ] || fail "a package could not read the file beside its code"
grep -q "native packages: wrote" "$work/first.log" || fail "the first start did not write its packages"
stop

# Second start: the tree is there, so nothing is written.
warm_boot=$(start 4702 "$work/rt" /api/thumb "$work/warm.log")
is_png http://localhost:4702/api/thumb || fail "sharp did not answer on the second start"
grep -q "native packages: wrote" "$work/warm.log" && fail "the second start wrote its packages again"
stop

# Two at once, into one empty directory.
start 4703 "$work/rt-two" /api/thumb "$work/two-a.log" > /dev/null &
a=$!
start 4704 "$work/rt-two" /api/thumb "$work/two-b.log" > /dev/null &
b=$!
wait "$a" "$b" || true
for port in 4703 4704; do
  is_png "http://localhost:$port/api/thumb" || fail "of two starting at once, the one on $port did not answer"
done
[ "$(find "$work/rt-two" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = 1 ] || fail "two starts at once left more than one tree: $(ls -a "$work/rt-two")"
stop

# Compiled for a platform whose packages are not installed: the build fails,
# and names them.
other=$([ "$(uname -m)" = x86_64 ] && echo arm64 || echo x64)
sed -i.bak "s|bun build --compile|bun build --compile --target=bun-linux-$other|" package.json && rm package.json.bak
if bun run compile > "$work/cross.log" 2>&1; then
  fail "compiling for linux-$other without its packages did not fail"
elif ! grep -q "@img/sharp-linux-$other" "$work/cross.log"; then
  fail "the cross-compile failure did not name the missing package"; tail -20 "$work/cross.log"
fi

for log in "$work"/first.log "$work"/warm.log; do grep -iE "error|failed" "$log" && failed=1; done

mb() { awk "BEGIN { printf \"%.1f MB\", $1 / 1048576 }"; }
echo
echo "| $(uname -s | tr A-Z a-z)-$(uname -m) | binary | start to first answer |"
echo "| --- | --- | --- |"
echo "| without native packages, first start | $(mb "$plain_size") | ${plain_boot} ms |"
echo "| without native packages, later starts | $(mb "$plain_size") | ${plain_warm} ms |"
echo "| with sharp, heic-convert, first start | $(mb "$native_size") | ${first_boot} ms |"
echo "| with sharp, heic-convert, later starts | $(mb "$native_size") | ${warm_boot} ms |"
echo

[ "$failed" = 0 ] && echo "binary native: sharp, heic-convert and a data file load from the written tree; second start wrote nothing; two at once shared one tree; a cross-compile without packages failed"
exit "$failed"
