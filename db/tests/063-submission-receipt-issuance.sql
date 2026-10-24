-- DAN-87 #595: immutable DB issuance freeze; every fixture is synthetic.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();
SELECT has_table('evidence', 'submission_receipt_issuance', 'issuance attempts have their own table');
SELECT has_function('app', 'prepare_submission_receipt', ARRAY['uuid','text','text'], 'the narrow preparation RPC exists');

SELECT is(pg_temp.call('ana','pkg-a','request-1',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'reserved', 'fixture: revision one exists');
SELECT is(pg_temp.ask('ana', $$ SELECT outcome FROM app.request_submission('doc-a',1) $$), 'requested', 'fixture: request');
SELECT is(pg_temp.ask('ana', format('SELECT outcome FROM app.record_submission((SELECT id FROM evidence.submission_request),%L)',pg_temp.h('d'))),
  'recorded', 'fixture: trusted server has recorded the matching reconstruction');
INSERT INTO ref SELECT 'submission', id::text FROM evidence.submission;
CREATE FUNCTION pg_temp.prepare(p_actor text, p_key text DEFAULT 'key-a', p_version text DEFAULT '1', p_column text DEFAULT 'outcome')
RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask(p_actor, format('SELECT %I::text FROM app.prepare_submission_receipt({submission}::uuid,%L,%L)',p_column,p_key,p_version))
$$;
SET LOCAL ROLE ductus_evidence;
INSERT INTO evidence.domain(id,institution_id,region)
  VALUES('00000000-0000-4000-8000-0000000000d3',pg_temp.id('fak_a'),'eu-west-1');
INSERT INTO evidence.signing_key
  (key_id,key_version,evidence_domain_id,institution_id,purpose,algorithm,key_base64url,valid_from,valid_to,revoked_at)
SELECT k.name,'1',k.domain::uuid,pg_temp.id(k.faculty),k.purpose,'Ed25519',
  'MCowBQYDK2VwAyEA'||translate(rtrim(encode(decode(repeat(k.byte,32),'hex'),'base64'),'='),'+/','-_'),
  date_trunc('minute',now())+k.start_at,date_trunc('minute',now())+k.end_at,
  CASE WHEN k.revoked THEN now() END
FROM (VALUES
  ('key-a','00000000-0000-4000-8000-0000000000d1','fak_a','receipt','11',interval '-1 day',NULL::interval,false),
  ('key-other','00000000-0000-4000-8000-0000000000d2','fak_b','receipt','22',interval '-1 day',NULL::interval,false),
  ('key-wrong-domain','00000000-0000-4000-8000-0000000000d3','fak_a','receipt','77',interval '-1 day',NULL::interval,false),
  ('key-checkpoint','00000000-0000-4000-8000-0000000000d1','fak_a','checkpoint','33',interval '-1 day',NULL::interval,false),
  ('key-revoked','00000000-0000-4000-8000-0000000000d1','fak_a','receipt','44',interval '-1 day',NULL::interval,true),
  ('key-future','00000000-0000-4000-8000-0000000000d1','fak_a','receipt','55',interval '1 day',NULL::interval,false),
  ('key-retired','00000000-0000-4000-8000-0000000000d1','fak_a','receipt','66',interval '-1 day',interval '0 minutes',false)
) AS k(name,domain,faculty,purpose,byte,start_at,end_at,revoked);
RESET ROLE;

SELECT row_eq($$ SELECT relowner::regrole::text,relrowsecurity,relforcerowsecurity FROM pg_class
  WHERE oid='evidence.submission_receipt_issuance'::regclass $$,ROW('ductus_evidence'::text,true,true),'owner and forced RLS');
SELECT bag_eq($$ SELECT r||':'||p FROM unnest(ARRAY['ductus_app','ductus_worker','ductus_retention','ductus_identity',
  'ductus_auth','ductus_migrator','ductus_test_stranger']) r CROSS JOIN
  unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  WHERE has_table_privilege(r,'evidence.submission_receipt_issuance',p) $$,
  ARRAY['ductus_app:SELECT'],'every role/operation: only app SELECT, no direct write');
SELECT bag_eq($$ SELECT r::text FROM unnest(ARRAY['ductus_app','ductus_worker','ductus_retention','ductus_identity',
  'ductus_auth','ductus_migrator','ductus_test_stranger']) r
  WHERE has_function_privilege(r,'app.prepare_submission_receipt(uuid,text,text)','EXECUTE') $$,
  ARRAY['ductus_app'],'only app executes the RPC');
SELECT ok((SELECT prosecdef AND 'search_path=""'=ANY(proconfig) AND proowner='ductus_evidence'::regrole
  FROM pg_proc WHERE oid='app.prepare_submission_receipt(uuid,text,text)'::regprocedure),'definer/owner/empty search_path');
SELECT is((SELECT proargnames[1:pronargs]::text FROM pg_proc
  WHERE oid='app.prepare_submission_receipt(uuid,text,text)'::regprocedure),
  '{p_submission_id,p_key_id,p_key_version}','no identity, time, payload or hash argument');

SELECT is(pg_temp.prepare(actor),'unauthorized',actor||' cannot prepare another student receipt')
FROM unnest(ARRAY['dora','boris','vesna','marko','iva','nina','tomo','lea','petra','anon','expired','closed','unknown']) actor;
SELECT is(pg_temp.prepare('ana',k),'key_unavailable','refuse key '||k)
FROM unnest(ARRAY['missing','key-other','key-wrong-domain','key-checkpoint','key-revoked','key-future','key-retired']) k;
SELECT is(pg_temp.prepare('ana','key-a','2'),'key_unavailable','wrong key version');
SELECT is(pg_temp.prepare('ana',NULL),'invalid','null key');
SELECT is(pg_temp.ask('ana',$$SELECT outcome FROM app.prepare_submission_receipt(NULL,'key-a','1')$$),'invalid','null submission');
SELECT is(pg_temp.ask('ana',$$SELECT outcome FROM app.prepare_submission_receipt({nobody}::uuid,'key-a','1')$$),
  'unauthorized','unknown submission has the same refusal');
SELECT is((SELECT count(*) FROM evidence.submission_receipt_issuance),0::bigint,'refusals leave no row');

SELECT clock_timestamp() AS before_prepare \gset
SELECT pg_sleep(0.002);
DO $$ BEGIN PERFORM set_config('app.user_id',pg_temp.id('tomo')::text,true); END $$;
SELECT is(pg_temp.prepare('ana'),'prepared','owner prepares the DB payload');
RESET app.user_id;
SELECT clock_timestamp() AS after_prepare \gset
CREATE TEMP TABLE first_attempt AS SELECT * FROM evidence.submission_receipt_issuance;
SELECT ok((SELECT signed_at>now() AND signed_at>=:'before_prepare'::timestamptz AND signed_at<=:'after_prepare'::timestamptz
  FROM first_attempt),'fresh DB clock, not transaction start');
SELECT ok((SELECT i.signed_at>=s.requested_at FROM first_attempt i JOIN evidence.submission s ON s.id=i.submission_id),
  'signedAt never precedes requestedAt');
SELECT is((SELECT payload_digest_sha256 FROM first_attempt),
  (SELECT pg_temp.sha(receipt_payload) FROM first_attempt),'DB SHA256 hashes the exact UTF8 payload');
SELECT is((SELECT count(*) FROM first_attempt i,jsonb_object_keys(i.receipt_payload::jsonb)),16::bigint,'all sixteen fields');
SELECT is((SELECT receipt_payload::jsonb->>'receiptSchema' FROM first_attempt),'ductus-submission-receipt-v2','separate v2 schema');
SELECT is((SELECT receipt_payload::jsonb->>'signedAt' FROM first_attempt),
  (SELECT to_char(signed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM first_attempt),'UTC6 signedAt');
SELECT row_eq($$SELECT (i.receipt_payload::jsonb->>'submissionId')::uuid,
  (i.receipt_payload::jsonb->>'principalId')::uuid,(i.receipt_payload::jsonb->>'assignmentId')::uuid,
  (i.receipt_payload::jsonb->>'revision')::bigint,i.receipt_payload::jsonb->>'artifactSha256',
  (i.receipt_payload::jsonb->>'requestedAt')::timestamptz,(i.receipt_payload::jsonb->>'dueAt')::timestamptz,
  (i.receipt_payload::jsonb->>'afterDeadline')::boolean FROM first_attempt i $$,
  (SELECT ROW(id,principal_id,assignment_id,revision,artifact_hash,requested_at,due_at,after_deadline) FROM evidence.submission),
  'submission identity, revision/hash and deadline come from the stored request');
SELECT is((SELECT receipt_payload::jsonb->>'evidenceHeadSegmentHash' FROM first_attempt),repeat('b',64),'head at requested revision');
SELECT is(pg_temp.prepare('ana'),'prepared','another attempt may get a new signing time');
SELECT is((SELECT count(*) FROM evidence.submission_receipt_issuance),2::bigint,'separate attempts');
SELECT results_eq($$SELECT row_to_json(i)::text FROM evidence.submission_receipt_issuance i JOIN first_attempt f USING(id)$$,
  $$SELECT row_to_json(f)::text FROM first_attempt f$$,'first attempt is byte-for-byte unchanged');
SELECT is(substr(pg_temp.ask_as('ductus_evidence','ana',$$INSERT INTO evidence.submission_receipt_issuance
  (submission_id,institution_id,principal_id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256)
  SELECT submission_id,{fak_b}::uuid,principal_id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256
  FROM evidence.submission_receipt_issuance LIMIT 1 RETURNING id::text$$),1,5),'23503','composite FK rejects a different institution');

-- No table access follows from a schema USAGE refusal: grant it explicitly.
GRANT USAGE ON SCHEMA evidence TO ductus_app,ductus_worker,ductus_retention,ductus_identity,ductus_auth,ductus_test_stranger;
SELECT is(pg_temp.ask(actor,$$SELECT count(*)::text FROM evidence.submission_receipt_issuance$$),
  CASE WHEN actor='ana' THEN '2' ELSE '0' END,'RLS reader '||actor)
FROM unnest(ARRAY['ana','dora','vesna','marko','iva','boris','tomo','lea','petra','anon','expired','closed','unknown']) actor;
GRANT SELECT ON evidence.submission_receipt_issuance TO ductus_worker,ductus_retention,ductus_identity,ductus_auth,ductus_test_stranger;
SELECT is(pg_temp.ask_as(r,'ana',$$SELECT count(*)::text FROM evidence.submission_receipt_issuance$$),'0','RLS with deliberate SELECT grant: '||r)
FROM unnest(ARRAY['ductus_worker','ductus_retention','ductus_identity','ductus_auth','ductus_test_stranger']) r;
SELECT is(pg_temp.ask_as('ductus_migrator','ana',$$SELECT count(*)::text FROM evidence.submission_receipt_issuance$$),
  '42501: permission denied for table submission_receipt_issuance','migrator inherits no owner table rights');
SELECT is(substr(pg_temp.ask('ana',$$INSERT INTO evidence.submission_receipt_issuance DEFAULT VALUES RETURNING id::text$$),1,5),
  '42501','app cannot INSERT');
SELECT is(substr(pg_temp.ask('ana',$$UPDATE evidence.submission_receipt_issuance SET key_version='2' RETURNING id::text$$),1,5),
  '42501','app cannot UPDATE');
SELECT is(substr(pg_temp.ask('ana',$$DELETE FROM evidence.submission_receipt_issuance RETURNING id::text$$),1,5),
  '42501','app cannot DELETE');
GRANT INSERT,UPDATE,DELETE ON evidence.submission_receipt_issuance TO ductus_app;
SELECT is(pg_temp.ask('ana',$$WITH x AS(UPDATE evidence.submission_receipt_issuance SET key_version='2' RETURNING id)
  SELECT count(*)::text FROM x$$),'0','RLS still prevents UPDATE after accidental grant');
SELECT is(pg_temp.ask('ana',$$WITH x AS(DELETE FROM evidence.submission_receipt_issuance RETURNING id)
  SELECT count(*)::text FROM x$$),'0','RLS still prevents DELETE after accidental grant');
SELECT is(substr(pg_temp.ask('ana',$$INSERT INTO evidence.submission_receipt_issuance
  (submission_id,institution_id,principal_id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256)
  SELECT submission_id,institution_id,principal_id,key_id,key_version,signed_at,receipt_payload,payload_digest_sha256
  FROM evidence.submission_receipt_issuance LIMIT 1 RETURNING id::text$$),1,5),'42501','RLS still prevents INSERT after accidental grant');
SELECT is(substr(pg_temp.ask_as('ductus_evidence','ana',$$UPDATE evidence.submission_receipt_issuance SET key_version='2' RETURNING id::text$$),1,5),
  'ZD403','owner cannot change a frozen attempt');
SELECT is(substr(pg_temp.ask_as('ductus_evidence','ana',$$DELETE FROM evidence.submission_receipt_issuance RETURNING id::text$$),1,5),
  'ZD403','owner cannot delete a frozen attempt');
SELECT is(substr(pg_temp.ask_as('ductus_evidence','ana',$$TRUNCATE evidence.submission_receipt_issuance$$),1,5),
  'ZD403','owner cannot truncate frozen attempts');
DROP POLICY submission_receipt_issuance_owner ON evidence.submission_receipt_issuance;
SELECT is(pg_temp.ask_as('ductus_evidence','ana',$$SELECT count(*)::text FROM evidence.submission_receipt_issuance$$),
  '0','FORCE subjects the owner to RLS when its policy is absent');
CREATE POLICY submission_receipt_issuance_owner ON evidence.submission_receipt_issuance
  TO ductus_evidence USING(true) WITH CHECK(true);

SET LOCAL ROLE ductus_identity;
UPDATE institution.course_member SET member_to=greatest(now(),member_from)
  WHERE course_id=pg_temp.id('k1') AND user_id=pg_temp.id('ana');
RESET ROLE;
SELECT is(pg_temp.prepare('ana'),'unauthorized','removed student cannot freeze another attempt');
SELECT is((SELECT count(*) FROM evidence.submission_receipt_issuance),2::bigint,'refused retry leaves frozen attempts unchanged');
SELECT * FROM finish();
ROLLBACK;
