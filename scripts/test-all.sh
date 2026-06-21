#!/usr/bin/env bash
# Run all package tests (core + per-agent) and the e2e suite.
# Tolerates empty test/ directories — packages without local tests
# still get their types validated via the root tsc check.

set -uo pipefail

cd "$(dirname "$0")/.."

fail=0
echo "== per-package tests =="
for pkg in packages/*; do
  [ -d "$pkg" ] || continue
  name=$(basename "$pkg")
  if [ -d "$pkg/test" ] && compgen -G "$pkg/test/*.test.ts" > /dev/null; then
    echo "-- $name"
    if ! (cd "$pkg" && node --test --import tsx test/*.test.ts 2>&1 | tail -5); then
      fail=1
    fi
  else
    echo "-- $name (no tests, skipped)"
  fi
done

echo
echo "== root scripts (release tooling) =="
if compgen -G "scripts/test/*.test.mjs" > /dev/null; then
  if ! (node --test scripts/test/*.test.mjs 2>&1 | tail -5); then
    fail=1
  fi
fi

echo
echo "== root e2e =="
if ! (node --test --import tsx scripts/e2e-hello-world.test.ts 2>&1 | tail -10); then
  fail=1
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "ALL TESTS PASSED"
else
  echo "TESTS FAILED"
  exit 1
fi