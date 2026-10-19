-- Local compose stack only; run by db/local/evidence-signing-key.mjs, which
-- passes the institution slug and the public key with its label and version
-- (docs/BACKEND.md 4.13 t. 7). Gives the institution its evidence domain when
-- it has none and registers the key as the domain's receipt key. One
-- transaction; a second run with the same key changes no row, and a key
-- label or public key the registry holds otherwise is an error, never a
-- rewrite. The local operator is the compose superuser over the socket.
\set ON_ERROR_STOP on
SELECT (
    pg_catalog.inet_server_addr() IS NULL
    AND pg_catalog.current_database() = 'ductus'
    AND session_user = 'ductus'
) AS trusted_local_operator \gset
\if :trusted_local_operator
\else
  DO $$ BEGIN RAISE EXCEPTION 'evidence signing key registration is local compose only'; END $$;
\endif

BEGIN;
SELECT pg_catalog.set_config('ductus_local.institution_slug', :'institution_slug', true) IS NOT NULL
   AND pg_catalog.set_config('ductus_local.key_id', :'key_id', true) IS NOT NULL
   AND pg_catalog.set_config('ductus_local.key_version', :'key_version', true) IS NOT NULL
   AND pg_catalog.set_config('ductus_local.key_base64url', :'key_base64url', true) IS NOT NULL AS ready \gset

DO $register$
DECLARE
  v_institution_id uuid;
  v_domains uuid[];
  v_key_id text := pg_catalog.current_setting('ductus_local.key_id');
  v_key_version text := pg_catalog.current_setting('ductus_local.key_version');
  v_key text := pg_catalog.current_setting('ductus_local.key_base64url');
BEGIN
  SELECT i.id INTO v_institution_id FROM identity.institution i
   WHERE i.slug = pg_catalog.current_setting('ductus_local.institution_slug') FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such institution; run pnpm db:seed first';
  END IF;
  -- open_student_work needs exactly one domain per institution.
  INSERT INTO evidence.domain (institution_id, region)
  SELECT v_institution_id, 'local'
   WHERE NOT EXISTS (SELECT 1 FROM evidence.domain d WHERE d.institution_id = v_institution_id);
  SELECT pg_catalog.array_agg(d.id) INTO v_domains FROM evidence.domain d WHERE d.institution_id = v_institution_id;
  IF pg_catalog.cardinality(v_domains) <> 1 THEN
    RAISE EXCEPTION 'the institution has more than one evidence domain';
  END IF;

  INSERT INTO evidence.signing_key
    (key_id, key_version, evidence_domain_id, institution_id, purpose, algorithm, key_base64url, valid_from)
  VALUES (v_key_id, v_key_version, v_domains[1], v_institution_id, 'receipt', 'Ed25519', v_key,
          pg_catalog.date_trunc('minute', pg_catalog.now()))
  ON CONFLICT DO NOTHING;
  -- The row must be exactly this key of this domain, still usable.
  PERFORM 1 FROM evidence.signing_key k
   WHERE k.key_id = v_key_id AND k.key_version = v_key_version AND k.key_base64url = v_key
     AND k.evidence_domain_id = v_domains[1] AND k.institution_id = v_institution_id
     AND k.purpose = 'receipt' AND k.revoked_at IS NULL
     AND (k.valid_to IS NULL OR k.valid_to > pg_catalog.now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the registry holds this key label or public key otherwise; make a new seed file';
  END IF;
END
$register$;

SELECT k.evidence_domain_id FROM evidence.signing_key k
 WHERE k.key_id = pg_catalog.current_setting('ductus_local.key_id');
COMMIT;
