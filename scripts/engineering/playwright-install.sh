#!/usr/bin/env bash
# Usage: bash scripts/engineering/playwright-install.sh <browser>...
# Installs Playwright browsers and their system packages (--with-deps).
# On a hit of the browser cache the install takes ~15 s, but the apt mirror of
# the runner now and then serves the packages at ~40 kB/s (11 minutes in CI run
# 39962985826). Every attempt but the last is capped, so a slow download is
# retried on a fresh connection; the last one is not capped and fails as before.
set -u

attempts=3
limit="${PLAYWRIGHT_INSTALL_TIMEOUT:-120}"

for attempt in $(seq 1 "$attempts"); do
  if [ "$attempt" -lt "$attempts" ]; then
    timeout --kill-after=10 "$limit" pnpm exec playwright install --with-deps "$@"
  else
    pnpm exec playwright install --with-deps "$@"
  fi
  status=$?
  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  echo "::warning::playwright install attempt ${attempt}/${attempts} failed (exit ${status})"
  # Leave no half-finished apt behind before the next attempt.
  sudo pkill -x apt-get || true
  sudo pkill -f "[/]usr/lib/apt/methods" || true
  sudo dpkg --configure -a || true
done

exit 1
