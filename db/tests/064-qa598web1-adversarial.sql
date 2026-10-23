-- Independent QA codex:qa598web1:qa, DAN-87 / PR598. Synthetic only.
-- Source 608c320fb30ccdb6748987709059acc61869a1ea; additive harness only.
\warn QA598-PGTAP BEGIN source=608c320fb30ccdb6748987709059acc61869a1ea
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();
SELECT is(pg_temp.call('ana','pkg-a','qa598-segment',pg_temp.descriptor(),0,
  repeat('a',64),repeat('d',64),repeat('b',64)),'reserved','setup: revision');
SELECT is(pg_temp.ask('ana',$$SELECT outcome FROM app.request_submission('doc-a',1)$$),
  'requested','setup: request');
SELECT is(pg_temp.ask('ana',format('SELECT outcome FROM app.record_submission((SELECT id FROM evidence.submission_request),%L)',pg_temp.h('d'))),
  'recorded','setup: recorded submission');
INSERT INTO ref SELECT 'submission',id::text FROM evidence.submission;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.signing_key(key_id,key_version,evidence_domain_id,institution_id,purpose,algorithm,key_base64url,valid_from)
VALUES('qa598-key','1','00000000-0000-4000-8000-0000000000d1',pg_temp.id('fak_a'),'receipt','Ed25519',
  'MCowBQYDK2VwAyEA'||translate(rtrim(encode(decode(repeat('81',32),'hex'),'base64'),'='),'+/','-_'),
  date_trunc('minute',clock_timestamp())-interval '1 day');
RESET ROLE;
CREATE FUNCTION pg_temp.qa598(p_actor text,p_key text,p_version text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor,format('SELECT outcome FROM app.prepare_submission_receipt({submission}::uuid,%L,%L)',p_key,p_version))
$$;
SELECT is(pg_temp.qa598('ana','qa598-key',''),'invalid','empty version');
SELECT is(pg_temp.qa598('ana',repeat('x',257),'1'),'invalid','257-character key');
SELECT is(pg_temp.qa598('ana','qa598-key',repeat('x',257)),'invalid','257-character version');
SELECT is(pg_temp.qa598('ana','''; SELECT 1; --','1'),'key_unavailable','SQL-looking key stays data');
SELECT is(pg_temp.ask('dora',$$SELECT (outcome='unauthorized' AND issuance_id IS NULL AND receipt_payload IS NULL
  AND payload_digest_sha256 IS NULL)::text FROM app.prepare_submission_receipt({submission}::uuid,'qa598-key','1')$$),
  'true','wrong actor gets no identifiers, payload or digest');
SELECT is((SELECT count(*) FROM evidence.submission_receipt_issuance),0::bigint,'all refusals leave zero attempts');
SET LOCAL TIME ZONE 'Pacific/Chatham';
SELECT is(pg_temp.qa598('ana','qa598-key','1'),'prepared','non-UTC session');
SELECT ok((SELECT receipt_payload::jsonb->>'signedAt' = to_char(signed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  FROM evidence.submission_receipt_issuance),'UTC6 payload independent of session zone');
CREATE TEMP TABLE qa598_before AS SELECT row_to_json(i)::text AS frozen FROM evidence.submission_receipt_issuance i;
CREATE TEMP TABLE qa598_submission_before AS SELECT row_to_json(s)::text AS frozen FROM evidence.submission s;
-- Retry in an aborted savepoint must leave the first attempt and source alone.
SAVEPOINT aborted_retry;
SELECT pg_temp.qa598('ana','qa598-key','1');
ROLLBACK TO SAVEPOINT aborted_retry;
SELECT results_eq($$SELECT row_to_json(i)::text FROM evidence.submission_receipt_issuance i$$,
  $$SELECT frozen FROM qa598_before$$,'rollback removes retry only');
SELECT results_eq($$SELECT row_to_json(s)::text FROM evidence.submission s$$,
  $$SELECT frozen FROM qa598_submission_before$$,'retry preserves requestedAt/revision/deadline');
GRANT USAGE ON SCHEMA evidence TO ductus_app;
GRANT TRUNCATE ON evidence.submission_receipt_issuance TO ductus_app;
SELECT is(substr(pg_temp.ask('ana',$$TRUNCATE evidence.submission_receipt_issuance$$),1,5),
  'ZD403','append-only trigger stops TRUNCATE even with deliberate grant');
SELECT is(substr(pg_temp.ask_as('ductus_evidence','ana',$$INSERT INTO evidence.submission_receipt_issuance
  (submission_id,institution_id,principal_id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256)
  SELECT submission_id,institution_id,principal_id,key_id,key_version,signed_at,receipt_payload,repeat('0',64)
  FROM evidence.submission_receipt_issuance RETURNING id::text$$),1,5),'23514','owner cannot insert mismatched exact-byte digest');
-- Exercise statements, not only has_*_privilege. Schema access is deliberate.
GRANT USAGE ON SCHEMA evidence,app TO ductus_worker,ductus_retention,ductus_identity,ductus_auth,ductus_migrator,ductus_test_stranger;
SELECT is(substr(pg_temp.ask_as(r,'ana',q),1,5),'42501','QA598 ACL '||r||' '||op)
FROM unnest(ARRAY['ductus_app','ductus_worker','ductus_retention','ductus_identity','ductus_auth','ductus_migrator','ductus_test_stranger']) r
CROSS JOIN (VALUES
  ('INSERT',$$INSERT INTO evidence.submission_receipt_issuance DEFAULT VALUES RETURNING id::text$$),
  ('UPDATE',$$UPDATE evidence.submission_receipt_issuance SET key_version='forged' RETURNING id::text$$),
  ('DELETE',$$DELETE FROM evidence.submission_receipt_issuance RETURNING id::text$$)
) ops(op,q);
SELECT is(substr(pg_temp.ask_as(r,'ana',$$SELECT outcome FROM app.prepare_submission_receipt({submission}::uuid,'qa598-key','1')$$),1,5),
  '42501','QA598 denied EXECUTE '||r)
FROM unnest(ARRAY['ductus_worker','ductus_retention','ductus_identity','ductus_auth','ductus_migrator','ductus_test_stranger']) r;
GRANT SELECT,INSERT,UPDATE,DELETE ON evidence.submission_receipt_issuance TO ductus_app,ductus_worker,ductus_retention,ductus_identity,ductus_auth,ductus_migrator,ductus_test_stranger;
SELECT is(pg_temp.ask(actor,$$SELECT count(*)::text FROM evidence.submission_receipt_issuance$$),
  CASE WHEN actor='ana' THEN '1' ELSE '0' END,'QA598 RLS actor '||actor)
FROM unnest(ARRAY['ana','dora','vesna','marko','iva','boris','nina','tomo','lea','petra','anon','expired','closed','unknown']) actor;
SELECT is(pg_temp.ask_as(r,'ana',$$SELECT count(*)::text FROM evidence.submission_receipt_issuance$$),'0','QA598 RLS service '||r)
FROM unnest(ARRAY['ductus_worker','ductus_retention','ductus_identity','ductus_auth','ductus_migrator','ductus_test_stranger']) r;
SELECT is(pg_temp.ask('ana',$$WITH x AS (UPDATE evidence.submission_receipt_issuance SET key_version='forged' RETURNING id)
  SELECT count(*)::text FROM x$$),'0','QA598 deliberate UPDATE grant remains blocked by RLS');
SELECT is(pg_temp.ask('ana',$$WITH x AS (DELETE FROM evidence.submission_receipt_issuance RETURNING id)
  SELECT count(*)::text FROM x$$),'0','QA598 deliberate DELETE grant remains blocked by RLS');
SELECT is(substr(pg_temp.ask('ana',$$INSERT INTO evidence.submission_receipt_issuance
  (submission_id,institution_id,principal_id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256)
  SELECT submission_id,institution_id,principal_id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256
  FROM evidence.submission_receipt_issuance RETURNING id::text$$),1,5),'42501','QA598 deliberate INSERT grant remains blocked by RLS');
SELECT is(substr(pg_temp.ask_as('ductus_evidence','ana',q),1,5),'ZD403','QA598 owner append-only '||op)
FROM (VALUES ('UPDATE',$$UPDATE evidence.submission_receipt_issuance SET key_version='forged' RETURNING id::text$$),
             ('DELETE',$$DELETE FROM evidence.submission_receipt_issuance RETURNING id::text$$),
             ('TRUNCATE',$$TRUNCATE evidence.submission_receipt_issuance$$)) ops(op,q);
-- Local corruption probe: remove the immutable record's head only inside a
-- rollback savepoint, then verify the real RPC refuses without a new attempt.
-- The helper restores the fixture before emitting the pgTAP assertion.
CREATE FUNCTION pg_temp.qa598_missing_head() RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  BEGIN
    ALTER TABLE evidence.receipt DISABLE TRIGGER ALL;
    DELETE FROM evidence.receipt;
    result := pg_temp.qa598('ana','qa598-key','1');
    RAISE EXCEPTION USING ERRCODE='ZQ598';
  EXCEPTION WHEN SQLSTATE 'ZQ598' THEN NULL;
  END;
  RETURN result;
END $$;
SELECT is(pg_temp.qa598_missing_head(),'unavailable','QA598 missing immutable head => unavailable');
SELECT results_eq($$SELECT row_to_json(i)::text FROM evidence.submission_receipt_issuance i$$,
  $$SELECT frozen FROM qa598_before$$,'QA598 all refused writes preserve initial attempt');
SELECT * FROM finish();
ROLLBACK;
\warn QA598-PGTAP END fixtures-and-grants-rolled-back

