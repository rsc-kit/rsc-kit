#!/usr/bin/env bash
# Prove an app's commands run the way a deploy runs them.
#
# Unit tests can say what the runner does with an exit code; they cannot say
# what a built app does with `./app migrate`. Three things only a build shows:
#
#   - the server is NOT started for a command. A static import of the server
#     starts it as the entry evaluates, before argv can be read, and a release
#     step run beside the serving version would bind its port;
#   - register() runs for the command that asks for it and for no other. The
#     entry runs it at import, and a flag set by whatever runs the command is
#     the only thing stopping that;
#   - the compiled binary, with and without --bytecode, does all of it;
#   - the app loads for a command the way it does for the server: the example's
#     startup imports an auth library that pulls in tsyringe, which refuses to
#     load until reflect-metadata has run - and a command does not go through
#     the Nitro plugin that arranges that for the server;
#   - a question (--help, an unknown name) needs no valid environment, and a
#     stop that arrives while the app loads is not a kill;
#   - a command reads its deadline from the context, and a stop that arrives
#     during register() starts the command with its signal already aborted;
#   - a stop that arrives while Bun is still PARSING the bundle is held too, in
#     a binary compiled with --splitting. Without it Bun parses every module
#     before running the first line of the entry, and the entry is what holds
#     the signal.
#
# Run from an app that has been built, with src/commands from examples/app:
#
#   cd examples/app && bun run build && bash ../../scripts/verify-commands.sh
set -uo pipefail

cd "${1:-.}"

# A deploy of an app that uses refreshOn sets this, and a built server started
# with no NODE_ENV is production in its own process too, so without it every
# page that renders a refreshOn section answers 500.
export RSC_SIGNING_SECRET="${RSC_SIGNING_SECRET:-verify-commands-signing-secret-0123456789abcdef}"

work="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null; rm -rf "$work"' EXIT

fail=0

# Wait for a process to end, for at most <seconds>, and say 124 and kill it if it
# does not: a worker that ignores its stop must fail this script, not hold CI.
await_exit() {
  local pid="$1" seconds="$2"

  for _ in $(seq 1 $((seconds * 10))); do
    kill -0 "$pid" 2>/dev/null || { wait "$pid"; return $?; }
    sleep 0.1
  done

  kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  return 124
}

# check <description> <want exit> <output pattern> <command...>
check() {
  local name="$1" want="$2" pattern="$3"
  shift 3

  local out code
  out="$("$@" 2>&1)"
  code=$?

  if [ "$code" != "$want" ] || ! grep -qE -- "$pattern" <<<"$out"; then
    echo "::error::$name: exited $code (want $want), output:"
    echo "$out" | sed 's/^/    /'
    fail=1
  else
    printf '  ok  %s\n' "$name"
  fi
}

# The same checks against each way of running a command.
commands() {
  local label="$1"
  shift
  local run=("$@")

  echo "--- $label"

  check "a command gets its arguments and shares the app's code" 0 'orders=1 args=\["a","b c"\] registered=false' "${run[@]}" orders a "b c"
  check "register() runs for the command that exports it" 0 'orders=2 registered=true' "${run[@]}" seed x
  check "the return value is the exit code (0)" 0 '' "${run[@]}" check ok
  check "the return value is the exit code (3)" 3 '' "${run[@]}" check
  check "an unknown command exits 2 and says so" 2 'Not a command: nope' "${run[@]}" nope
  check "--help lists them, with their descriptions" 0 'orders +Count the orders the pages share' "${run[@]}" --help

  # Nothing that is only a question needs a valid environment: a build machine
  # or a CI step without the database url still lists the commands. Nor does a
  # command that did not ask for register(): it runs without instrumentation.ts,
  # whose environment is the server's. One that did ask needs it, and says why.
  RSC_EXAMPLE_BAD_ENV=1 check "--help does not need a valid environment" 0 'migrate|orders +Count' "${run[@]}" --help
  RSC_EXAMPLE_BAD_ENV=1 check "an unknown name does not either" 2 'Not a command: nope' "${run[@]}" nope
  RSC_EXAMPLE_BAD_ENV=1 check "a command without register() does not load instrumentation.ts" 0 'orders=[0-9]+ args=\[\] registered=false' "${run[@]}" orders
  RSC_EXAMPLE_BAD_ENV=1 check "a command with register() and a bad environment fails, and says why" 1 'RSC_EXAMPLE_BAD_ENV' "${run[@]}" seed

  # A worker: told to stop, it stops, and the process exits 0.
  "${run[@]}" work > "$work/work.log" 2>&1 &
  local pid=$!

  for _ in $(seq 1 50); do
    grep -q 'work: started' "$work/work.log" 2>/dev/null && break
    sleep 0.1
  done

  kill -TERM "$pid" 2>/dev/null
  await_exit "$pid" 15
  local code=$?

  if [ "$code" != 0 ] || ! grep -q 'work: stopped, deadline set' "$work/work.log"; then
    echo "::error::SIGTERM did not stop the worker cleanly, or it could not read its deadline: exited $code, output:"
    sed 's/^/    /' "$work/work.log"
    fail=1
  else
    printf '  ok  %s\n' "SIGTERM stops a worker, which exits 0"
  fi

  # Told to stop while the app is still loading. Until the runner has the
  # signals, the default action ends the process with 143 and the worker never
  # starts; held and handed over, it starts already told, and stops.
  RSC_EXAMPLE_SLOW_IMPORT=1 "${run[@]}" work > "$work/early.log" 2>&1 &
  pid=$!

  for _ in $(seq 1 200); do
    grep -q 'loading slowly' "$work/early.log" 2>/dev/null && break
    sleep 0.05
  done

  kill -TERM "$pid" 2>/dev/null
  await_exit "$pid" 15
  code=$?

  # And the command is told before it starts, not a moment after: a signal is
  # delivered on the loop's next turn, which a synchronous load never gives, and
  # Node and Bun differ in when they would otherwise take it.
  if [ "$code" != 0 ] || ! grep -q 'work: started, already told to stop' "$work/early.log"; then
    echo "::error::SIGTERM while the app was loading: exited $code (143 is the default action), want a command that starts already told to stop, output:"
    sed 's/^/    /' "$work/early.log"
    fail=1
  else
    printf '  ok  %s\n' "SIGTERM while the app loads is a stop, and the command starts told"
  fi

  # Told to stop while register() runs: the runner has the signals by then, so
  # the command's signal is aborted before the command starts, and its abort
  # event has already fired. A command that only listened would never return.
  RSC_EXAMPLE_SLOW_REGISTER=1 "${run[@]}" work > "$work/register.log" 2>&1 &
  pid=$!

  for _ in $(seq 1 200); do
    grep -q 'registering slowly' "$work/register.log" 2>/dev/null && break
    sleep 0.05
  done

  kill -TERM "$pid" 2>/dev/null
  await_exit "$pid" 15
  code=$?

  if [ "$code" != 0 ] || ! grep -q 'work: started, already told to stop' "$work/register.log"; then
    echo "::error::SIGTERM during register(): exited $code, want a command that starts with its signal aborted, output:"
    sed 's/^/    /' "$work/register.log"
    fail=1
  else
    printf '  ok  %s\n' "a stop during register() starts the command already aborted"
  fi
}

grep -q '"commands"' .output/rsc-kit.json || { echo "::error::.output/rsc-kit.json does not list the commands"; fail=1; }

commands "node .output/server/commands.mjs" node .output/server/commands.mjs
commands "bun .output/server/commands.mjs" bun .output/server/commands.mjs

# No command is a usage error from the commands entry: it has no server to start.
check "commands.mjs with no command is a usage error" 2 'Usage:' node .output/server/commands.mjs

# The compiled binary: the same commands, and still the server with no arguments.
for flags in "" "--bytecode" "--splitting"; do
  tag="${flags#--}"
  bin="$work/app-${tag:-plain}"

  # shellcheck disable=SC2086
  bun build --compile $flags .output/server/compile.mjs --outfile "$bin" > /dev/null || { echo "::error::could not compile ${flags:-plain}"; fail=1; continue; }

  commands "the compiled binary ${flags:-}" "$bin"

  port=$((30000 + RANDOM % 20000))

  PORT=$port "$bin" > "$work/server.log" 2>&1 &
  server=$!

  for _ in $(seq 1 50); do
    curl -fsS -o /dev/null "http://localhost:$port/" 2>/dev/null && break
    sleep 0.2
  done

  got=$(curl -sS -o /dev/null -w '%{http_code}' "http://localhost:$port/")

  if [ "$got" != 200 ]; then
    echo "::error::the binary with no arguments did not serve (${flags:-plain}): $got"
    sed 's/^/    /' "$work/server.log"
    fail=1
  else
    printf '  ok  %s\n' "no arguments is the server"
  fi

  # With the server holding the port, a command must not try to bind it.
  PORT=$port check "a command runs beside the serving version" 0 'orders=1 args=\["beside"\]' "$bin" orders beside

  got=$(curl -sS -o /dev/null -w '%{http_code}' "http://localhost:$port/")
  [ "$got" = 200 ] || { echo "::error::running a command took the server down (${flags:-plain}): $got"; fail=1; }

  kill -TERM "$server" 2>/dev/null
  wait "$server" 2>/dev/null
done

# --sourcemap writes .map files beside the binary, which it does not read: the
# binary alone, in another directory, still runs its commands and its server.
mkdir -p "$work/maps-out" "$work/maps-alone"
if bun build --compile --splitting --sourcemap .output/server/compile.mjs --outfile "$work/maps-out/app" > /dev/null; then
  cp "$work/maps-out/app" "$work/maps-alone/app"
  check "a binary compiled with --sourcemap runs, alone, without its .map files" 0 'orders=1 args=\[\]' bash -c 'cd "$1" && ./app orders' _ "$work/maps-alone"
else
  echo "::error::could not compile with --splitting --sourcemap"
  fail=1
fi

# A stop that arrives while Bun parses the bundle. The app here is small, so
# this makes it big: a module of functions that never run, imported by a copy of
# the compile entry. Bun parses all of it before the entry's first line, unless
# --splitting made the entry its own chunk.
server=.output/server
node -e '
  const fs = require("fs")
  const out = ["globalThis.__never = function () {\n"]
  for (let n = 0, size = 0; size < 80e6; n++) {
    const line = `function f${n}(a, b, c) { const x = a + ${n}; if (x > b) { return c.map(function (i) { return i * x + ${n} }) } for (let k = 0; k < x; k++) { b += k * ${n * 7} } return { a: x, b: b, c: "${n.toString(16)}" } }\n`
    out.push(line)
    size += line.length
  }
  out.push("return f0\n}\n")
  fs.writeFileSync(process.argv[1], out.join(""))
  const entry = fs.readFileSync(process.argv[2], "utf-8")
  const marker = ".then(() => (BARE_COMMANDS.includes(argv[0])"
  if (!entry.includes(marker)) { console.error("compile.mjs has no app import to put the big module before"); process.exit(1) }
  fs.writeFileSync(process.argv[3], entry.replace(marker, ".then(() => import(\"./parse-window.mjs\"))\n      " + marker))
' "$server/parse-window.mjs" "$server/compile.mjs" "$server/parse-window-entry.mjs" || { echo "::error::could not make the big bundle"; fail=1; }

if [ -f "$server/parse-window-entry.mjs" ]; then
  bun build --compile "$server/parse-window-entry.mjs" --outfile "$work/window-plain" > /dev/null || { echo "::error::could not compile the big bundle"; fail=1; }
  bun build --compile --splitting "$server/parse-window-entry.mjs" --outfile "$work/window-split" > /dev/null || { echo "::error::could not compile the big bundle with --splitting"; fail=1; }
  rm -f "$server/parse-window.mjs" "$server/parse-window-entry.mjs"
fi

if [ -x "$work/window-split" ] && [ -x "$work/window-plain" ]; then
  # A binary that has just been written is slow to start the first time (it is
  # read in, and on macOS checked), and a stop that arrives before the entry has
  # run is the default action in any build. Run both once so that what is timed
  # and stopped is the parse.
  "$work/window-split" --help > /dev/null 2>&1
  "$work/window-plain" --help > /dev/null 2>&1

  # --help is answered by the entry, so how long it takes without --splitting is
  # how long Bun spent parsing first. The stop below has to land inside that.
  parse=$({ TIMEFORMAT=%R; time "$work/window-plain" --help > /dev/null 2>&1; } 2>&1)

  if awk -v t="$parse" 'BEGIN { exit !(t < 0.8) }'; then
    echo "::warning::Bun parsed the big bundle in ${parse}s, which a stop at 0.25s may not land inside: this proves less than it should"
  fi

  # The same stop against the build without --splitting is the control: what it
  # exits with is told, not asserted, since it is Bun's to change.
  "$work/window-plain" work > "$work/window-plain.log" 2>&1 &
  pid=$!
  sleep 0.25
  kill -TERM "$pid" 2>/dev/null
  await_exit "$pid" 30
  printf '      (without --splitting the same stop exits %s; 143 is the default action)\n' "$?"

  "$work/window-split" work > "$work/window.log" 2>&1 &
  pid=$!
  sleep 0.25
  kill -TERM "$pid" 2>/dev/null
  await_exit "$pid" 30
  code=$?

  if [ "$code" != 0 ] || ! grep -q 'work: stopped' "$work/window.log"; then
    echo "::error::SIGTERM while Bun parsed a big bundle (--splitting): exited $code (143 is the default action), output:"
    sed 's/^/    /' "$work/window.log"
    fail=1
  else
    printf '  ok  %s\n' "SIGTERM while Bun parses a big bundle is a stop with --splitting (plain parse: ${parse}s)"
  fi
fi

[ "$fail" = 0 ] || exit 1
echo "✅ commands run from the plain build and from the binary, and never start the server"
