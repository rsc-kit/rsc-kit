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
#   - the compiled binary, with and without --bytecode, does all of it.
#
# Run from an app that has been built, with src/commands from examples/app:
#
#   cd examples/app && bun run build && bash ../../scripts/verify-commands.sh
set -uo pipefail

cd "${1:-.}"

work="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null; rm -rf "$work"' EXIT

fail=0

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

  # A worker: told to stop, it stops, and the process exits 0.
  "${run[@]}" work > "$work/work.log" 2>&1 &
  local pid=$!

  for _ in $(seq 1 50); do
    grep -q 'work: started' "$work/work.log" 2>/dev/null && break
    sleep 0.1
  done

  kill -TERM "$pid" 2>/dev/null
  wait "$pid"
  local code=$?

  if [ "$code" != 0 ] || ! grep -q 'work: stopped' "$work/work.log"; then
    echo "::error::SIGTERM did not stop the worker cleanly: exited $code, output:"
    sed 's/^/    /' "$work/work.log"
    fail=1
  else
    printf '  ok  %s\n' "SIGTERM stops a worker, which exits 0"
  fi
}

grep -q '"commands"' .output/rsc-kit.json || { echo "::error::.output/rsc-kit.json does not list the commands"; fail=1; }

commands "node .output/server/commands.mjs" node .output/server/commands.mjs
commands "bun .output/server/commands.mjs" bun .output/server/commands.mjs

# No command is a usage error from the commands entry: it has no server to start.
check "commands.mjs with no command is a usage error" 2 'Usage:' node .output/server/commands.mjs

# The compiled binary: the same commands, and still the server with no arguments.
for flags in "" "--bytecode"; do
  bin="$work/app${flags:+-bytecode}"

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

[ "$fail" = 0 ] || exit 1
echo "✅ commands run from the plain build and from the binary, and never start the server"
