-- DAN-189 / #356: RPC identity, ownership and execution boundaries.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

SELECT is((SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure),
  'ductus_evidence', 'the narrow RPC is owned by the NOLOGIN evidence role');
SELECT ok((SELECT prosecdef AND 'search_path=""' = ANY(proconfig)
  FROM pg_proc WHERE oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure),
  'the RPC is SECURITY DEFINER with an empty search_path');
SELECT ok(
  has_function_privilege('ductus_app', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_worker', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_retention', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_auth', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('ductus_test_stranger', 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ), 'only ductus_app receives EXECUTE on the RPC');
SELECT is_empty(
  $$ SELECT name FROM unnest((SELECT proargnames[1:pronargs]
       FROM pg_proc WHERE oid = 'app.commit_evidence_segment(text,text,bigint,text,text,jsonb,text,text,text)'::regprocedure)) AS name
      WHERE name IN ('principal_id', 'p_principal_id', 'institution_id', 'p_institution_id') $$,
  'the RPC accepts neither principal_id nor institution_id');
SELECT is_empty(
  $$ SELECT table_name || ':' || privilege
       FROM unnest(ARRAY['domain','project','document','document_revision','package','segment','receipt']) AS tables(table_name)
       CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) AS privileges(privilege)
      WHERE has_table_privilege('ductus_app', 'evidence.' || table_name, privilege) $$,
  'ductus_app has no direct evidence DML or TRUNCATE');

SELECT matches(pg_temp.ask_as('ductus_test_stranger', 'ana',
  $$ SELECT outcome FROM app.commit_evidence_segment('pkg-a','request-denied',0,repeat('a',64),repeat('d',64),
       pg_temp.descriptor()::jsonb,repeat('b',64),'synthetic://denied',repeat('d',64)) $$),
  '^42501:.*$', 'an unrelated role cannot execute the RPC');
SELECT is(pg_temp.call('anon','pkg-a','request-anon',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'unauthorized', 'an anonymous session is refused');
SELECT is(pg_temp.call('expired','pkg-a','request-expired',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'unauthorized', 'an expired session is refused');
SELECT is(pg_temp.call('tomo','pkg-a','request-cross-tenant',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'unauthorized', 'a different institution cannot probe a package request');
SELECT is(pg_temp.call('boris','pkg-a','request-nonmember',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'unauthorized', 'a same-institution student cannot reserve on another student''s package');
SELECT is(pg_temp.call('ana','pkg-a','request-context',
  pg_temp.descriptor(p_package=>'pkg-b',p_document=>'doc-b'),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'context_mismatch', 'the descriptor cannot mix package and document context');
SELECT is(pg_temp.call('ana','pkg-a','   ',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'invalid', 'a whitespace-only request id is refused');
SELECT is(pg_temp.call('ana','pkg-a',pg_catalog.chr(160),pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'invalid', 'a non-breaking-space-only request id is refused');
SELECT is(pg_temp.call('ana','pkg-a',repeat('😀',65),pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'invalid', 'a request id over 128 UTF-16 units is refused');

SELECT is(pg_temp.call('ana','pkg-a','request-auth',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'reserved', 'the active student can reserve their own package');
SELECT is(pg_temp.call_with_spoofed_user_id(), 'duplicate_pending',
  'a forged user-id GUC cannot replace the active session identity');
SELECT is(pg_temp.ask('ana', $$ SELECT principal_id::text FROM evidence.receipt WHERE client_request_id='request-auth' $$),
  pg_temp.id('ana')::text, 'the accepted receipt records the session principal');
-- Authorization precedes the idempotency lookup: an existing request id of
-- another student is neither recovered nor confirmed.
SELECT is(pg_temp.call('tomo','pkg-a','request-auth',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'unauthorized', 'a different institution cannot recover an existing request');
SELECT is(pg_temp.call('tomo','pkg-a','request-auth',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64),'receipt_payload'),
  NULL, 'a different institution gets no receipt for an existing request');
SELECT is(pg_temp.call('boris','pkg-a','request-auth',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)),
  'unauthorized', 'a same-institution student cannot recover another student''s request');
SELECT is(pg_temp.call('boris','pkg-a','request-auth',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64),'receipt_payload'),
  NULL, 'a same-institution student gets no receipt for another student''s request');

CREATE SCHEMA evidence_attack;
CREATE FUNCTION evidence_attack.length(text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;
GRANT USAGE ON SCHEMA evidence_attack TO ductus_app, ductus_evidence;
GRANT EXECUTE ON FUNCTION evidence_attack.length(text) TO ductus_app, ductus_evidence;
CREATE FUNCTION pg_temp.call_with_hostile_search_path() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_outcome text; v_old_path text := pg_catalog.current_setting('search_path', true);
BEGIN
  PERFORM pg_catalog.set_config('search_path','evidence_attack,pg_catalog',true);
  v_outcome := pg_temp.call('ana','pkg-a',repeat('x',129),pg_temp.descriptor(),0,
    repeat('a',64),repeat('d',64),repeat('b',64));
  PERFORM pg_catalog.set_config('search_path',v_old_path,true);
  RETURN v_outcome;
END
$$;
SELECT is(pg_temp.call_with_hostile_search_path(), 'invalid',
  'a caller-controlled search_path cannot shadow RPC built-ins');

-- Plan #356 item 2: the package owner who is no longer an active student of
-- the assignment's course (member_to set, as remove_student writes it) cannot
-- reserve a new, otherwise valid segment. Last block: it ends Ana's membership.
UPDATE institution.course_member SET member_to = now()
 WHERE course_id = pg_temp.id('k1') AND user_id = pg_temp.id('ana') AND member_to IS NULL;
SELECT is(pg_temp.call('ana','pkg-a','request-removed',
  pg_temp.descriptor(p_segment=>'segment-a-2',p_sequence_from=>2,p_sequence_to=>2,p_hash=>repeat('c',64),p_predecessor=>repeat('b',64)),
  1,repeat('d',64),repeat('e',64),repeat('c',64)),
  'unauthorized', 'a student removed from the course cannot reserve on their own package');
SELECT is((SELECT current_revision::text || ':' ||
  (SELECT count(*) FROM evidence.segment WHERE evidence_package_id='pkg-a')
  FROM evidence.document WHERE id='doc-a'), '1:1', 'the refused removed student writes nothing');

SELECT * FROM finish();
ROLLBACK;
