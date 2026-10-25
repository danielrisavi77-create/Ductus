-- DAN-291 (#746, 291a): one bound submission receipt per submission, returned
-- unchanged. Every person, key and signature below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();
SELECT has_table('evidence', 'submission_receipt', 'bound receipts have their own table');
SELECT has_function('app', 'attach_submission_receipt', ARRAY['uuid','text','jsonb'], 'the bind RPC exists');
SELECT has_function('app', 'read_submission_receipt', ARRAY['uuid'], 'the read RPC exists');

SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'reserved', 'fixture: revision one exists');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a',1) $$), 'requested', 'fixture: request');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission((SELECT id FROM evidence.submission_request),%L)',pg_temp.h('d'))),
  'recorded', 'fixture: recorded submission');
INSERT INTO ref SELECT 'submission', id::text FROM evidence.submission;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.signing_key
  (key_id,key_version,evidence_domain_id,institution_id,purpose,algorithm,key_base64url,valid_from,valid_to)
SELECT k.name,'1',k.domain::uuid,pg_temp.id(k.faculty),'receipt','Ed25519',
  'MCowBQYDK2VwAyEA'||translate(rtrim(encode(decode(repeat(k.byte,32),'hex'),'base64'),'='),'+/','-_'),
  date_trunc('minute',now())+k.start_at,date_trunc('minute',now())+k.end_at
FROM (VALUES
  ('key-a','00000000-0000-4000-8000-0000000000d1','fak_a','11',interval '-1 day',NULL::interval),
  ('key-late','00000000-0000-4000-8000-0000000000d1','fak_a','22',interval '-1 day',NULL::interval),
  ('key-other','00000000-0000-4000-8000-0000000000d2','fak_b','33',interval '-1 day',NULL::interval),
  ('key-retired','00000000-0000-4000-8000-0000000000d1','fak_a','44',interval '-1 day',interval '0 minutes'),
  ('key-future','00000000-0000-4000-8000-0000000000d1','fak_a','55',interval '1 day',NULL::interval)
) AS k(name,domain,faculty,byte,start_at,end_at);
RESET ROLE;

CREATE FUNCTION pg_temp.sig(p_key text, p_version text DEFAULT '1', p_fill text DEFAULT 'A') RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('algorithm','Ed25519','keyId',p_key,'keyVersion',p_version,
    'signatureEncoding','raw','signatureBase64Url',repeat(p_fill,85)||'A')
$$;
-- outcome|payload|digest|signature; NULL parts are left out.
CREATE FUNCTION pg_temp.attach(p_actor text, p_issuance text, p_signature jsonb, p_digest text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT concat_ws(''|'',outcome,receipt_payload,payload_digest_sha256,signature::text) FROM app.attach_submission_receipt(%s::uuid,%L,%L::jsonb)',
    coalesce('{'||p_issuance||'}','NULL'),
    coalesce(p_digest,(SELECT payload_digest_sha256 FROM evidence.submission_receipt_issuance WHERE id::text=(SELECT val FROM ref WHERE name=p_issuance))),
    p_signature::text))
$$;
CREATE FUNCTION pg_temp.read(p_actor text, p_submission text DEFAULT '{submission}') RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format(
    'SELECT concat_ws(''|'',outcome,receipt_payload,payload_digest_sha256,signature::text) FROM app.read_submission_receipt(%s::uuid)',
    p_submission))
$$;
CREATE FUNCTION pg_temp.prepare(p_name text, p_key text) RETURNS text LANGUAGE sql AS $$
  INSERT INTO ref SELECT p_name, pg_temp.ask('ana', format(
    'SELECT issuance_id::text FROM app.prepare_submission_receipt({submission}::uuid,%L,''1'')', p_key))
  RETURNING val
$$;

-- Catalogue and access matrix.
SELECT row_eq($$ SELECT relowner::regrole::text,relrowsecurity,relforcerowsecurity FROM pg_class
  WHERE oid='evidence.submission_receipt'::regclass $$,ROW('ductus_evidence'::text,true,true),'owner and forced RLS');
SELECT bag_eq($$ SELECT polname::text||' '||polroles::regrole[]::text FROM pg_policy WHERE polrelid='evidence.submission_receipt'::regclass $$,
  ARRAY['submission_receipt_owner {ductus_evidence}'],'only the owner''s policy');
SELECT is_empty($$ SELECT r||':'||p FROM unnest(ARRAY['ductus_app','ductus_worker','ductus_retention','ductus_identity',
  'ductus_auth','ductus_migrator','ductus_test_stranger']) r CROSS JOIN
  unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  WHERE has_table_privilege(r,'evidence.submission_receipt',p) $$,'no role reads or writes the table directly, not even SELECT');
SELECT is((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='evidence.submission_receipt'::regclass AND contype='f'),
  'FOREIGN KEY (issuance_id, submission_id, institution_id, principal_id) REFERENCES evidence.submission_receipt_issuance(id, submission_id, institution_id, principal_id)',
  'only a frozen attempt of the same submission, institution and student is bound');
SELECT bag_eq($$ SELECT r||' '||f FROM unnest(ARRAY['ductus_app','ductus_worker','ductus_retention','ductus_identity',
  'ductus_auth','ductus_migrator','ductus_test_stranger']) r CROSS JOIN
  unnest(ARRAY['app.attach_submission_receipt(uuid,text,jsonb)','app.read_submission_receipt(uuid)']) f
  WHERE has_function_privilege(r,f,'EXECUTE') $$,
  ARRAY['ductus_app app.attach_submission_receipt(uuid,text,jsonb)','ductus_app app.read_submission_receipt(uuid)'],
  'only the web role executes the two RPCs');
SELECT is_empty($$ SELECT oid::regprocedure::text FROM pg_proc
  WHERE oid IN ('app.attach_submission_receipt(uuid,text,jsonb)'::regprocedure,'app.read_submission_receipt(uuid)'::regprocedure)
    AND (NOT prosecdef OR proowner<>'ductus_evidence'::regrole OR NOT 'search_path=""'=ANY(proconfig)) $$,
  'both RPCs are SECURITY DEFINER of the evidence role with an empty search_path');
SELECT is(pg_get_function_arguments('app.attach_submission_receipt(uuid,text,jsonb)'::regprocedure),
  'p_issuance_id uuid, p_payload_digest_sha256 text, p_signature jsonb','no person, institution, time or payload argument');
SELECT is(pg_get_function_arguments('app.read_submission_receipt(uuid)'::regprocedure),'p_submission_id uuid','read takes the submission only');

-- Attempts: two of key-a, one of key-late (revoked after it), and two frozen
-- directly by the test with a signedAt the RPC never gives, so the key
-- validity checks are reached without waiting for the clock.
SELECT ok(pg_temp.prepare('i1','key-a') IS NOT NULL,'fixture: first attempt');
SELECT pg_sleep(0.002);
SELECT ok(pg_temp.prepare('i2','key-a') IS NOT NULL,'fixture: second attempt');
SELECT ok(pg_temp.prepare('i_late','key-late') IS NOT NULL,'fixture: attempt with a key revoked afterwards');
SELECT isnt((SELECT signed_at FROM evidence.submission_receipt_issuance WHERE id=pg_temp.id('i1')),
  (SELECT signed_at FROM evidence.submission_receipt_issuance WHERE id=pg_temp.id('i2')),'the two attempts have different signedAt');
SET LOCAL ROLE ductus_evidence;
UPDATE evidence.signing_key SET revoked_at=now() WHERE key_id='key-late';
RESET ROLE;
WITH i AS (INSERT INTO evidence.submission_receipt_issuance
    (submission_id,institution_id,principal_id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256)
  SELECT f.submission_id,f.institution_id,f.principal_id,s.key_id,'1',
    CASE WHEN s.valid_to IS NULL THEN clock_timestamp() ELSE s.valid_to-interval '1 hour' END,f.receipt_payload,f.payload_digest_sha256
  FROM evidence.submission_receipt_issuance f, evidence.signing_key s
  WHERE f.id=pg_temp.id('i1') AND s.key_id IN ('key-retired','key-future') RETURNING id,key_id)
INSERT INTO ref SELECT CASE key_id WHEN 'key-retired' THEN 'i_retired' ELSE 'i_future' END, id::text FROM i;

SELECT is(pg_temp.read('ana'),'none','own submission without a bound receipt');
SELECT is(pg_temp.attach('anon','i1',pg_temp.sig('key-a')),'unauthorized','no session binds nothing');
SELECT is(pg_temp.attach('ana',NULL,pg_temp.sig('key-a'),repeat('0',64)),'invalid','null attempt');
SELECT is(pg_temp.attach('ana','i1',pg_temp.sig('key-a'),upper(pg_temp.h('x'))),'invalid','upper-case digest');
SELECT is(pg_temp.attach('ana','i1',pg_temp.sig('key-a'),repeat('0',63)),'invalid','short digest');
SELECT is(pg_temp.attach('ana','i1',s),'invalid','envelope '||n) FROM (VALUES
  ('not an object','[]'::jsonb),('extra field',pg_temp.sig('key-a')||'{"extra":1}'),('missing field',pg_temp.sig('key-a')-'keyVersion'),
  ('other algorithm',pg_temp.sig('key-a')||'{"algorithm":"ECDSA_P256_SHA256"}'),('other encoding',pg_temp.sig('key-a')||'{"signatureEncoding":"der"}'),
  ('63 bytes',pg_temp.sig('key-a')||jsonb_build_object('signatureBase64Url',repeat('A',85))),
  ('non-canonical base64url',pg_temp.sig('key-a')||jsonb_build_object('signatureBase64Url',repeat('A',85)||'B')),
  ('key id not text',pg_temp.sig('key-a')||'{"keyId":1}'),('key version not text',pg_temp.sig('key-a')||'{"keyVersion":1}')) AS e(n,s);
SELECT is(pg_temp.attach(a,'i1',pg_temp.sig('key-a')),'not_found',a||' cannot bind the attempt')
  FROM unnest(ARRAY['boris','dora','vesna','tomo']) a;
SELECT is(pg_temp.attach('ana','nobody',pg_temp.sig('key-a'),repeat('0',64)),'not_found','unknown attempt');
SELECT is(pg_temp.attach('ana','i1',pg_temp.sig('key-a'),repeat('0',64)),'digest_mismatch','digest not of the frozen payload');
SELECT is(pg_temp.attach('ana','i1',pg_temp.sig('key-other')),'key_mismatch','another key than the frozen one');
SELECT is(pg_temp.attach('ana','i1',pg_temp.sig('key-a','2')),'key_mismatch','another version of the frozen key');
SELECT is(pg_temp.attach('ana','i_late',pg_temp.sig('key-a')),'key_mismatch','a valid key that was not frozen');
SELECT is(pg_temp.attach('ana','i_late',pg_temp.sig('key-late')),'key_revoked','key revoked after the freeze');
SELECT is(pg_temp.attach('ana','i_retired',pg_temp.sig('key-retired')),'key_not_valid','validity ended before the bind');
SELECT is(pg_temp.attach('ana','i_future',pg_temp.sig('key-future')),'key_not_valid','signedAt before validity');
SELECT is((SELECT count(*) FROM evidence.submission_receipt),0::bigint,'refusals write nothing');

-- The bind, then every later bind of the same submission: the stored row.
SELECT is(pg_temp.attach('ana','i1',pg_temp.sig('key-a')),
  (SELECT concat_ws('|','attached',receipt_payload,payload_digest_sha256,pg_temp.sig('key-a')::text)
     FROM evidence.submission_receipt_issuance WHERE id=pg_temp.id('i1')),'attached: frozen payload and digest, given signature');
CREATE TEMP TABLE bound AS SELECT * FROM evidence.submission_receipt;
SELECT row_eq($$ SELECT issuance_id,key_id,key_version,signed_at,receipt_payload FROM bound $$,
  (SELECT ROW(id,key_id,key_version,signed_at,receipt_payload) FROM evidence.submission_receipt_issuance WHERE id=pg_temp.id('i1')),
  'the bound row copies the frozen attempt');
SELECT is(pg_temp.attach('ana','i2',pg_temp.sig('key-a','1','B')),
  (SELECT concat_ws('|','existing',receipt_payload,payload_digest_sha256,signature::text) FROM bound),
  'second attempt with another signedAt and signature gets the first row byte for byte');
SELECT is(pg_temp.attach('ana','i1',pg_temp.sig('key-a','1','B')),
  (SELECT concat_ws('|','existing',receipt_payload,payload_digest_sha256,signature::text) FROM bound),'repeat gets the stored signature');
SELECT is(split_part(pg_temp.attach('ana','i_late',pg_temp.sig('key-late'),repeat('0',64)),'|',1),'existing',
  'once bound, no other check runs');
SELECT results_eq($$ SELECT row_to_json(r)::text FROM evidence.submission_receipt r $$,
  $$ SELECT row_to_json(b)::text FROM bound b $$,'one row, unchanged');
SELECT is(pg_temp.read('ana'),(SELECT concat_ws('|','found',receipt_payload,payload_digest_sha256,signature::text) FROM bound),
  'read returns the stored row');
SELECT is(pg_temp.read(a),'not_found','read: '||a) FROM unnest(ARRAY['boris','vesna','tomo']) a;
SELECT is(pg_temp.read('ana','{nobody}'),'not_found','read: unknown submission');
SELECT is(pg_temp.read('ana','NULL'),'not_found','read: null submission');
SELECT is(pg_temp.read('anon'),'unauthorized','read without a session');

-- Append-only, also for the owner; RLS holds with a mistaken grant.
SELECT is(substr(pg_temp.ask_as('ductus_evidence','anon',s),1,5),'ZD403','owner: '||s) FROM unnest(ARRAY[
  $$UPDATE evidence.submission_receipt SET key_version=key_version RETURNING 1$$,
  $$DELETE FROM evidence.submission_receipt RETURNING 1$$,'TRUNCATE evidence.submission_receipt']) s;
SELECT is(substr(pg_temp.ask_as('ductus_evidence','anon',$$INSERT INTO evidence.submission_receipt
  SELECT submission_id,institution_id,principal_id,id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256,
    pg_temp.sig('key-a') FROM evidence.submission_receipt_issuance WHERE id={i2} RETURNING 1$$),1,5),'23505','one receipt per submission');
GRANT USAGE ON SCHEMA evidence TO ductus_app;
SELECT is(substr(pg_temp.ask('ana','SELECT count(*)::text FROM evidence.submission_receipt'),1,5),'42501','app cannot SELECT');
GRANT SELECT,INSERT,UPDATE,DELETE ON evidence.submission_receipt TO ductus_app;
SELECT is(pg_temp.ask('ana','SELECT count(*)::text FROM evidence.submission_receipt'),'0','mistaken grant: SELECT sees 0 rows');
SELECT is(pg_temp.ask('ana','WITH x AS (UPDATE evidence.submission_receipt SET key_version=key_version RETURNING 1) SELECT count(*)::text FROM x'),
  '0','mistaken grant: UPDATE touches 0 rows');
SELECT is(pg_temp.ask('ana','WITH x AS (DELETE FROM evidence.submission_receipt RETURNING 1) SELECT count(*)::text FROM x'),
  '0','mistaken grant: DELETE touches 0 rows');
SELECT is(substr(pg_temp.ask('ana',$$INSERT INTO evidence.submission_receipt
  SELECT submission_id,institution_id,principal_id,id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256,
    '{"keyId":"key-a","keyVersion":"1"}' FROM evidence.submission_receipt_issuance WHERE id={i2} RETURNING 1$$),1,5),
  '42501','mistaken grant: INSERT refused by RLS');
REVOKE ALL ON evidence.submission_receipt FROM ductus_app;
DROP POLICY submission_receipt_owner ON evidence.submission_receipt;
SELECT is(pg_temp.ask_as('ductus_evidence','anon','SELECT count(*)::text FROM evidence.submission_receipt'),'0',
  'FORCE subjects the owner to RLS when its policy is absent');
CREATE POLICY submission_receipt_owner ON evidence.submission_receipt TO ductus_evidence USING (true) WITH CHECK (true);

-- A removed student binds nothing more but still reads the stored receipt.
UPDATE institution.course_member SET member_to=greatest(now(),member_from)
  WHERE course_id=pg_temp.id('k1') AND user_id=pg_temp.id('ana');
SELECT is(pg_temp.attach('ana','i2',pg_temp.sig('key-a')),'not_found','removed student cannot bind');
SELECT is(split_part(pg_temp.read('ana'),'|',1),'found','removed student still reads the stored receipt');
SELECT * FROM finish();
ROLLBACK;
