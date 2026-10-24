-- B-8 step 4a / DAN-83 (docs/BACKEND.md 4.13 t. 6 and 7): the web process
-- reads the public keys of its institution's evidence domains, to verify a
-- stored receipt and to hand the keys to the work route. Public keys are no
-- secret; the reach is the session's institution, as for evidence.domain.
-- Nothing else changes: no write grant, no write policy.
-- migrate:up

SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;

CREATE POLICY evidence_signing_key_read ON evidence.signing_key FOR SELECT TO ductus_app
  USING (institution_id = (SELECT app.current_institution_id()));
GRANT SELECT ON evidence.signing_key TO ductus_app;
RESET ROLE;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
SET LOCAL ROLE ductus_evidence;
REVOKE SELECT ON evidence.signing_key FROM ductus_app;
DROP POLICY evidence_signing_key_read ON evidence.signing_key;
RESET ROLE;
