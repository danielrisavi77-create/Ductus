#!/usr/bin/env bash
# Usage: bash scripts/engineering/playwright-install.sh <browser>...
# Installs Playwright browsers and their system packages (--with-deps).
# On a hit of the browser cache the install takes ~15 s, but the apt mirror of
# the runner now and then serves the packages at ~40 kB/s (11 minutes in CI run
# 39962985826), and an uncapped last attempt hung for over 40 minutes (DAN-663,
# run 42043256952). So every attempt is capped by PLAYWRIGHT_INSTALL_TIMEOUT
# (seconds) and the whole script, retries and cleanup included, by
# PLAYWRIGHT_INSTALL_BUDGET; the last attempt gets what is left of the budget.
# When the budget is spent the script stops with an ::error:: and exit 1.
# A capped retry does not help when the mirror is slow for the whole job (8 min
# in run 39991517355), so a Chromium-only run (a pull request) may set
# PLAYWRIGHT_TRY_WITHOUT_DEPS=1 to skip apt: it installs the browser alone and
# keeps that only if Chromium really launches, else it falls through to the
# --with-deps path below. The tests have no screenshot baselines, so missing
# fonts do not change a result.
# PLAYWRIGHT_SKIP_DEPS=1 installs the browsers alone (macOS needs no packages).
# PLAYWRIGHT_APT_CACHE_DIR (a leading ~/ means $HOME) keeps the downloaded .deb
# files between runs: they are copied into the apt archive before the install
# and back after a success. The cache is a speed-up only; it never fails a run.
# DAN-705: when the runner's apt mirror azure.archive.ubuntu.com does not
# resolve (run 43034842276), the --with-deps path first points the apt sources
# at the first fallback that does, with a ::warning::: archive.ubuntu.com, else
# mirrors.edge.kernel.org, an Ubuntu mirror outside the ubuntu.com DNS zone
# (archive.ubuntu.com stopped resolving too, run 43059075223). A resolving
# mirror changes nothing.
# The ubuntu-24.04 image names its mirrors in /etc/apt/apt-mirrors.txt
# (mirror+file: in ubuntu.sources), older images in the sources files.
# PLAYWRIGHT_APT_ROOT (tests only) is the directory that holds etc/apt.
set -u

browsers="$*"
budget="${PLAYWRIGHT_INSTALL_BUDGET:-600}"
limit="${PLAYWRIGHT_INSTALL_TIMEOUT:-120}"
attempts=3

for value in "$budget" "$limit"; do
  case "$value" in
    '' | *[!0-9]* | 0)
      echo "::error::PLAYWRIGHT_INSTALL_BUDGET and PLAYWRIGHT_INSTALL_TIMEOUT must be whole seconds above 0"
      exit 1
      ;;
  esac
done

# cap <seconds> <command>...: runs the command and stops its whole process
# group after the given time (exit 124). GNU timeout first; System32's
# timeout.exe on Windows and BSD tools are not it, so the check reads --version.
# Perl is the fallback where coreutils is missing (macOS without Homebrew).
if timeout --version 2>/dev/null | grep -q 'GNU coreutils'; then
  cap() { timeout --kill-after=10 "$@"; }
elif gtimeout --version 2>/dev/null | grep -q 'GNU coreutils'; then
  cap() { gtimeout --kill-after=10 "$@"; }
elif perl -MPOSIX -e 1 >/dev/null 2>&1; then
  cap() {
    perl -MPOSIX=:sys_wait_h -e '
      my $secs = shift;
      my $pid = fork // die "fork: $!\n";
      if (!$pid) { setpgrp(0, 0); exec @ARGV or die "exec: $!\n"; }
      $SIG{ALRM} = sub {
        kill "TERM", -$pid;
        for (1 .. 10) { exit 124 if waitpid($pid, WNOHANG) > 0; sleep 1; }
        kill "KILL", -$pid; waitpid($pid, 0); exit 124;
      };
      alarm $secs; waitpid($pid, 0); alarm 0;
      exit(($? & 127) ? 128 + ($? & 127) : $? >> 8);
    ' "$@"
  }
else
  echo "::error::Playwright browsers (${browsers}) were not installed: no GNU timeout, gtimeout or perl to cap the install"
  exit 1
fi

# window <seconds>: the smaller of the given time and what is left of the budget.
window() {
  local left=$((budget - SECONDS))
  if [ "$left" -lt "$1" ]; then echo "$left"; else echo "$1"; fi
}

describe() {
  case "$1" in
    124 | 137) echo "timed out after $2s" ;;
    *) echo "failed (exit $1)" ;;
  esac
}

apt_cache=""
archives="${PLAYWRIGHT_APT_ARCHIVES:-/var/cache/apt/archives}"
if [ -n "${PLAYWRIGHT_APT_CACHE_DIR:-}" ] && [ "${PLAYWRIGHT_SKIP_DEPS:-}" != "1" ] && command -v apt-get >/dev/null 2>&1; then
  apt_cache="${PLAYWRIGHT_APT_CACHE_DIR}"
  case "$apt_cache" in \~/*) apt_cache="${HOME}/${apt_cache#\~/}" ;; esac
fi

restore_apt_cache() {
  [ -n "$apt_cache" ] || return 0
  compgen -G "${apt_cache}/*.deb" >/dev/null || return 0
  local t
  t=$(window 60)
  if ! { [ "$t" -gt 0 ] && cap "$t" sudo cp "$apt_cache"/*.deb "$archives"/; }; then
    echo "::warning::could not restore the apt package cache from ${apt_cache}"
  fi
}

# The save runs after a successful install, so it gets only what is left of the
# budget. It copies into a fresh directory first: a copy cut off by the budget
# never leaves a half-written .deb in the cache.
save_apt_cache() {
  [ -n "$apt_cache" ] || return 0
  if ! compgen -G "${archives}/*.deb" >/dev/null; then
    echo "::notice::apt left no .deb files in ${archives}; the apt package cache stays empty"
    return 0
  fi
  local t part=""
  t=$(window 60)
  if [ "$t" -le 0 ]; then
    echo "::notice::no time left in the ${budget}s budget to save the apt package cache"
    return 0
  fi
  if mkdir -p "$apt_cache" && part=$(mktemp -d "${apt_cache}/.part.XXXXXX") \
    && cap "$t" cp "$archives"/*.deb "$part"/ && mv -f "$part"/*.deb "$apt_cache"/; then
    rm -rf "$part"
    return 0
  fi
  [ -n "$part" ] && rm -rf "$part"
  echo "::warning::could not save the apt package cache to ${apt_cache}"
}

# The install runs apt-get update itself, so switched sources apply from the
# first attempt. A failed switch only warns: the attempts below run as before.
mirror="azure.archive.ubuntu.com"
fallbacks=(archive.ubuntu.com mirrors.edge.kernel.org)
resolves() {
  local t
  t=$(window 10)
  [ "$t" -gt 0 ] && cap "$t" getent hosts "$1" >/dev/null
}
use_reachable_mirror() {
  local f t fallback files=()
  local etc="${PLAYWRIGHT_APT_ROOT:-}/etc/apt"
  for f in "$etc/apt-mirrors.txt" "$etc/sources.list.d/ubuntu.sources" "$etc/sources.list"; do
    [ -f "$f" ] && grep -qF "//${mirror}" "$f" && files+=("$f")
  done
  [ "${#files[@]}" -gt 0 ] || return 0
  resolves "$mirror" && return 0
  for fallback in "${fallbacks[@]}"; do
    resolves "$fallback" || continue
    t=$(window 20)
    if [ "$t" -gt 0 ] && cap "$t" sudo sed -i "s#//${mirror//./\\.}#//${fallback}#g" "${files[@]}"; then
      echo "::warning::${mirror} does not resolve; the apt sources now use ${fallback}"
    else
      echo "::warning::${mirror} does not resolve and the apt sources could not be switched to ${fallback}"
    fi
    return 0
  done
  echo "::warning::${mirror} does not resolve and neither does any fallback (${fallbacks[*]}); the apt sources stay as they are"
}

finish_ok() {
  save_apt_cache
  exit 0
}

if [ "${PLAYWRIGHT_TRY_WITHOUT_DEPS:-}" = "1" ] && [ "$browsers" = "chromium" ]; then
  t=$(window "$limit")
  if [ "$t" -gt 0 ] && cap "$t" pnpm exec playwright install chromium; then
    t=$(window "$limit")
    if [ "$t" -gt 0 ] && cap "$t" pnpm exec node --input-type=module -e "import { chromium } from '@playwright/test'; const browser = await chromium.launch(); await browser.close();"; then
      exit 0
    fi
  fi
  echo "::warning::Chromium did not start without system packages; installing them (--with-deps)"
fi

if [ "${PLAYWRIGHT_SKIP_DEPS:-}" = "1" ]; then
  install=(pnpm exec playwright install "$@")
else
  install=(pnpm exec playwright install --with-deps "$@")
  use_reachable_mirror
  restore_apt_cache
fi

tried=0
status=0
for attempt in $(seq 1 "$attempts"); do
  if [ "$attempt" -lt "$attempts" ]; then t=$(window "$limit"); else t=$((budget - SECONDS)); fi
  [ "$t" -gt 0 ] || break
  tried=$attempt
  cap "$t" "${install[@]}"
  status=$?
  [ "$status" -eq 0 ] && finish_ok
  echo "::warning::playwright install attempt ${attempt}/${attempts} $(describe "$status" "$t")"
  [ "${PLAYWRIGHT_SKIP_DEPS:-}" = "1" ] && continue
  # Leave no half-finished apt behind before the next attempt.
  t=$(window 20); [ "$t" -gt 0 ] && cap "$t" sudo pkill -x apt-get
  t=$(window 20); [ "$t" -gt 0 ] && cap "$t" sudo pkill -f "[/]usr/lib/apt/methods"
  t=$(window 60); [ "$t" -gt 0 ] && cap "$t" sudo dpkg --configure -a
done

echo "::error::Playwright browsers (${browsers}) could not be installed within ${budget}s (${tried} of ${attempts} attempts, last exit ${status}); see the warnings above. The runner's apt mirror may be slow: re-run the job."
exit 1
