-- Local and CI stack only: invented institutions for the demo login (B-6).
-- `pnpm db:seed` runs it after `pnpm db:migrate`. The fake OIDC provider
-- (infra/fake-oidc) releases hrEduPersonHomeOrg demo.ductus.test, so its
-- accounts land in "Demo fakultet". The second institution takes no logins
-- (aai_home_org NULL): an unknown home organisation is refused, never mapped
-- to a default. Production institutions are provisioned, never seeded.
\set ON_ERROR_STOP on
SELECT pg_catalog.inet_server_addr() IS NULL AS local_socket \gset
\if :local_socket
\else
  DO $$ BEGIN RAISE EXCEPTION 'db/local/seed.sql is for the local compose stack only'; END $$;
\endif

INSERT INTO identity.institution (slug, aai_home_org) VALUES
  ('demo-fakultet', 'demo.ductus.test'),
  ('demo-bez-prijave', NULL)
ON CONFLICT (slug) DO UPDATE SET aai_home_org = EXCLUDED.aai_home_org;
