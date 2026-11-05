-- Local and CI stack only: invented institutions for the demo login (B-6).
-- `pnpm db:seed` runs it after `pnpm db:migrate`. The fake OIDC provider
-- (infra/fake-oidc) releases hrEduPersonHomeOrg demo.ductus.test or
-- b.demo.ductus.test, so each of its accounts lands in exactly one of "Demo
-- fakultet" and "Demo fakultet B" (DAN-483). The third institution takes no
-- logins (aai_home_org NULL): an unknown home organisation is refused, never
-- mapped to a default. Production institutions are provisioned, never seeded.
\set ON_ERROR_STOP on
SELECT pg_catalog.inet_server_addr() IS NULL AS local_socket \gset
\if :local_socket
\else
  DO $$ BEGIN RAISE EXCEPTION 'db/local/seed.sql is for the local compose stack only'; END $$;
\endif

INSERT INTO identity.institution (slug, aai_home_org) VALUES
  ('demo-fakultet', 'demo.ductus.test'),
  ('demo-fakultet-b', 'b.demo.ductus.test'),
  ('demo-bez-prijave', NULL)
ON CONFLICT (slug) DO UPDATE SET aai_home_org = EXCLUDED.aai_home_org;

-- Both login institutions take the fake provider's issuer, in the spelling
-- the login route stores (DAN-159); the home organisation, not the issuer,
-- tells them apart. The institution without logins takes no issuer either.
INSERT INTO identity.institution_issuer (institution_id, oidc_issuer)
SELECT id, 'http://localhost:8090'
  FROM identity.institution WHERE slug IN ('demo-fakultet', 'demo-fakultet-b')
ON CONFLICT DO NOTHING;

-- Only the invented login institutions can enroll in the local demo. The
-- table defaults are the owner's five attempts / fifteen minutes; a rerun
-- must leave any configured display name and limits untouched.
INSERT INTO institution.institution_settings (institution_id, display_name)
SELECT id, CASE slug WHEN 'demo-fakultet' THEN 'Demo fakultet (test)' ELSE 'Demo fakultet B (test)' END
  FROM identity.institution WHERE slug IN ('demo-fakultet', 'demo-fakultet-b')
ON CONFLICT (institution_id) DO NOTHING;
