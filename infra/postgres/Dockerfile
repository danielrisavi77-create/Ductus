# Local and CI database only (compose.yaml): PostgreSQL plus pgTAP and
# pg_prove for `pnpm test:db`. Production runs managed PostgreSQL without
# pgTAP; tests create the extension inside their own transaction (db/tests).
# Debian base because the image already trusts the signed PGDG repository.
ARG POSTGRES_BASE_IMAGE=postgres:17.11-trixie
FROM ${POSTGRES_BASE_IMAGE}

# pgTAP is SQL only. Its 1.3.4-1.pgdg13+2 rebuild ("No source changes") depends on
# postgresql-17 (>> 17.12) and cannot install next to the image's server, so use
# the +1 build, which depends on postgresql-17 without a version. If PGDG drops
# it from the index the build fails here instead of upgrading PostgreSQL.
ARG PGTAP_VERSION=1.3.4-1.pgdg13+1

COPY assert-pg-version.sh /usr/local/bin/assert-pg-version.sh

# DAN-711: postgresql-17-pgtap depends on postgresql-17, so an unpinned install
# upgrades server and pg_dump to the newest PGDG release over the image and the
# D-91 schema.sql check fails. Pin both to PG_VERSION (set by the official
# image) and fail the build if anything still moved. Upgrade PostgreSQL only by
# changing the base image digest together with db/schema.sql.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    "postgresql-17=${PG_VERSION}" "postgresql-client-17=${PG_VERSION}" \
    "postgresql-17-pgtap=${PGTAP_VERSION}" libtap-parser-sourcehandler-pgtap-perl \
  && sh /usr/local/bin/assert-pg-version.sh "$PG_VERSION" \
    "$(dpkg-query -W -f='${Version}' postgresql-17)" \
    "$(dpkg-query -W -f='${Version}' postgresql-client-17)" \
  && rm -rf /var/lib/apt/lists/*
