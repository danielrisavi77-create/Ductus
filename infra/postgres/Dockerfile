# Local and CI database only (compose.yaml): PostgreSQL plus pgTAP and
# pg_prove for `pnpm test:db`. Production runs managed PostgreSQL without
# pgTAP; tests create the extension inside their own transaction (db/tests).
# Debian base because the image already trusts the signed PGDG repository.
ARG POSTGRES_BASE_IMAGE=postgres:17.11-trixie
FROM ${POSTGRES_BASE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-pgtap libtap-parser-sourcehandler-pgtap-perl \
  && rm -rf /var/lib/apt/lists/*
