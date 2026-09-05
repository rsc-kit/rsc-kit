#!/usr/bin/env bash
#
# Retry a command with linear backoff.
#
# Exists for `bun install` and for the packed-tarball e2e, which installs
# React from the registry in a throwaway project. A transient registry
# failure should cost ten seconds, not a rerun.
set -uo pipefail

attempts=${RETRY_ATTEMPTS:-3}

for ((i = 1; i <= attempts; i++)); do
  "$@" && exit 0
  status=$?
  if ((i == attempts)); then
    echo "::error::'$*' failed after $attempts attempts (exit $status)"
    exit "$status"
  fi
  delay=$((i * 10))
  echo "::warning::'$*' failed (attempt $i/$attempts, exit $status) — retrying in ${delay}s"
  sleep "$delay"
done
