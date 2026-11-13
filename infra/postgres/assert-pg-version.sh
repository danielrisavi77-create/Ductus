#!/bin/sh
# DAN-711: fail the image build when an apt install moved PostgreSQL away from
# the base image version. Usage: assert-pg-version.sh EXPECTED INSTALLED...
expected=$1
if [ -z "$expected" ]; then
  echo "assert-pg-version: PG_VERSION is empty; the base image must set it" >&2
  exit 1
fi
shift
if [ "$#" -eq 0 ]; then
  echo "assert-pg-version: no installed version given" >&2
  exit 1
fi
for installed in "$@"; do
  if [ "$installed" != "$expected" ]; then
    echo "assert-pg-version: PostgreSQL version drift: installed '$installed', image '$expected'" >&2
    exit 1
  fi
done
