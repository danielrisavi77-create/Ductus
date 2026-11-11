-- DAN-293 (M3.3-P03): the worker's read of reconstruction checkpoints, for one
-- evidence package of its own evidence domain. The texts are stand-ins such
-- as repeat('d', 64); every person, document and package below is invented.
BEGIN;
SET LOCAL lc_messages TO 'C';
\ir fixtures/evidence-acceptance.inc
SELECT no_plan();

CREATE FUNCTION pg_temp.worker(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ask_as('ductus_worker', 'anon', p_sql)
$$;
-- The first letter of each returned text in hash order, '-' for no row, or 'CODE: message'.
CREATE FUNCTION pg_temp.texts(p_domain text, p_package text, p_hashes text[]) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.worker(format(
    $q$ SELECT coalesce(string_agg(left(body, 1), ',' ORDER BY content_hash), '-')
          FROM app.worker_package_checkpoints(%s, %s, %s) $q$,
    coalesce(quote_literal(p_domain) || '::uuid', 'NULL::uuid'),
    coalesce(quote_literal(p_package), 'NULL::text'),
    coalesce(quote_literal(p_hashes) || '::text[]', 'NULL::text[]')))
$$;
-- Hashes in the order the adapter sends them: sorted, without repeats.
CREATE FUNCTION pg_temp.sorted(VARIADIC p_letters text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT array_agg(pg_temp.h(l) ORDER BY pg_temp.h(l)) FROM unnest(p_letters) AS l
$$;
-- The letters of d, e, f in hash order, as pg_temp.texts lists them.
CREATE FUNCTION pg_temp.order_of(VARIADIC p_letters text[]) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(l, ',' ORDER BY pg_temp.h(l)) FROM unnest(p_letters) AS l
$$;

-- C1: the catalogue: a read-only definer of the evidence role with an empty
-- search_path, executed by the worker alone.
SELECT ok((SELECT p.prosecdef AND p.proowner = 'ductus_evidence'::regrole AND 'search_path=""' = ANY (p.proconfig)
             AND p.provolatile = 's'
           FROM pg_proc p WHERE p.oid = 'app.worker_package_checkpoints(uuid, text, text[])'::regprocedure),
  'the checkpoint read is a STABLE SECURITY DEFINER function of the evidence role with an empty search_path');
SELECT is(pg_get_function_result('app.worker_package_checkpoints(uuid, text, text[])'::regprocedure),
  'TABLE(content_hash text, body text)',
  'a checkpoint comes back as its hash and text: no revision, time, document, institution or person');
SELECT is_empty(
  $$ SELECT r FROM unnest(ARRAY['ductus_app', 'ductus_retention', 'ductus_auth', 'ductus_identity',
                                'ductus_app_local', 'ductus_auth_local', 'public']) AS r
      WHERE has_function_privilege(r, 'app.worker_package_checkpoints(uuid, text, text[])'::regprocedure, 'EXECUTE') $$,
  'no role but the worker executes the checkpoint read, nor PUBLIC');
SELECT ok(has_function_privilege('ductus_worker', 'app.worker_package_checkpoints(uuid, text, text[])'::regprocedure,
    'EXECUTE'), 'the worker executes the checkpoint read');
SELECT ok(NOT has_schema_privilege('ductus_evidence', 'app', 'CREATE'), 'the migration leaves no schema right behind');

-- Fixture: Ana commits revisions 1 to 3 of doc-a (texts d, e, f) in d1; Tomo
-- commits revision 1 of doc-b in d2, whose text is the same as Ana's revision 1.
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-1', pg_temp.descriptor(), 0, repeat('a', 64), repeat('d', 64),
  repeat('b', 64)), 'reserved', 'fixture: Ana commits revision 1');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-2',
    pg_temp.descriptor(p_segment => 'segment-a-2', p_sequence_from => 2, p_sequence_to => 2,
                       p_hash => repeat('c', 64), p_predecessor => repeat('b', 64)),
    1, repeat('d', 64), repeat('e', 64), repeat('c', 64)), 'reserved', 'fixture: Ana commits revision 2');
SELECT is(pg_temp.call('ana', 'pkg-a', 'request-3',
    pg_temp.descriptor(p_segment => 'segment-a-3', p_sequence_from => 3, p_sequence_to => 3,
                       p_hash => repeat('9', 64), p_predecessor => repeat('c', 64)),
    2, repeat('e', 64), repeat('f', 64), repeat('9', 64)), 'reserved', 'fixture: Ana commits revision 3');
SELECT is(pg_temp.call('tomo', 'pkg-b', 'request-b1',
    pg_temp.descriptor(p_package => 'pkg-b', p_document => 'doc-b', p_segment => 'segment-b-1'),
    0, repeat('c', 64), repeat('d', 64), repeat('b', 64)), 'reserved', 'fixture: Tomo commits revision 1');

-- C2: the worker gets the texts of the asked hashes of its package.
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d1', 'pkg-a', pg_temp.sorted('d', 'e', 'f')),
  pg_temp.order_of('d', 'e', 'f'), 'the worker gets the texts of revisions 1 to 3 of pkg-a');
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d1', 'pkg-a', pg_temp.sorted('e')), 'e',
  'only the asked hash comes back');
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d1', 'pkg-a', pg_temp.sorted('e', 'x')), 'e',
  'a hash no checkpoint has gives no row');
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d2', 'pkg-b', pg_temp.sorted('d')), 'd',
  'the worker gets the text of Tomo''s revision 1 under d2');
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d2', 'pkg-b', pg_temp.sorted('e', 'f')), '-',
  'Ana''s texts are not found under Tomo''s package, though they exist in another institution');

-- C3: a package asked under another domain, an unknown package and an
-- unknown domain give no row, in either direction.
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d2', 'pkg-a', pg_temp.sorted('d', 'e', 'f')), '-',
  'pkg-a of d1 asked under d2 gives no row');
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d1', 'pkg-b', pg_temp.sorted('d')), '-',
  'pkg-b of d2 asked under d1 gives no row');
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d1', 'pkg-nema', pg_temp.sorted('d')), '-',
  'an unknown package gives no row');
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000ee', 'pkg-a', pg_temp.sorted('d')), '-',
  'an unknown domain gives no row');

-- C4: a request outside the contract is refused, never read as a wildcard.
SELECT is(pg_temp.texts(d.domain, d.package, d.hashes), '22023: invalid worker request', 'refused: ' || d.label)
FROM (VALUES
  (NULL, 'pkg-a', pg_temp.sorted('d'), 'a NULL domain'),
  ('00000000-0000-4000-8000-0000000000d1', NULL, pg_temp.sorted('d'), 'a NULL package'),
  ('00000000-0000-4000-8000-0000000000d1', 'pkg-a', NULL, 'a NULL hash list'),
  ('00000000-0000-4000-8000-0000000000d1', 'pkg-a', '{}'::text[], 'an empty hash list'),
  ('00000000-0000-4000-8000-0000000000d1', 'pkg-a', ARRAY[NULL::text], 'a NULL hash'),
  ('00000000-0000-4000-8000-0000000000d1', 'pkg-a', ARRAY[upper(pg_temp.h('d'))], 'an upper-case hash'),
  ('00000000-0000-4000-8000-0000000000d1', 'pkg-a', ARRAY[left(pg_temp.h('d'), 63)], 'a short hash'),
  ('00000000-0000-4000-8000-0000000000d1', 'pkg-a', ARRAY[repeat('g', 64)], 'a hash that is not hex'),
  ('00000000-0000-4000-8000-0000000000d1', 'pkg-a', ARRAY[pg_temp.h('d'), pg_temp.h('d')], 'a repeated hash'),
  ('00000000-0000-4000-8000-0000000000d1', 'pkg-a',
   (SELECT array_agg(lpad(to_hex(n), 64, '0') ORDER BY n) FROM generate_series(1, 257) AS n), 'more than 256 hashes'),
  ('00000000-0000-4000-8000-0000000000d1', 'pkg-a', ARRAY[[pg_temp.h('d')], [pg_temp.h('e')]], 'a two-level array'),
  ('00000000-0000-4000-8000-0000000000d1', 'Pkg-a', pg_temp.sorted('d'), 'an upper-case package id'),
  ('00000000-0000-4000-8000-0000000000d1', '', pg_temp.sorted('d'), 'an empty package id'),
  ('00000000-0000-4000-8000-0000000000d1', 'pkg/../b', pg_temp.sorted('d'), 'a package id with a path'))
  AS d (domain, package, hashes, label);
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d1', 'pkg-a',
    (SELECT array_agg(h ORDER BY h) FROM (SELECT pg_temp.h('d') AS h
       UNION ALL SELECT lpad(to_hex(n), 64, '0') FROM generate_series(1, 255) AS n) AS a)),
  'd', '256 hashes are accepted');

-- C5: a text whose bytes no longer hash to its key is never returned.
ALTER TABLE evidence.document_checkpoint DISABLE TRIGGER evidence_checkpoint_immutable;
UPDATE evidence.document_checkpoint SET body = repeat('z', 64) WHERE document_id = 'doc-a' AND revision = 2;
ALTER TABLE evidence.document_checkpoint ENABLE TRIGGER evidence_checkpoint_immutable;
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d1', 'pkg-a', pg_temp.sorted('d', 'e', 'f')),
  pg_temp.order_of('d', 'f'), 'a text that does not hash to its key is not returned');

-- C6 (Istodobnost): a checkpoint removed between two reads is absent from
-- the second, not served from an earlier answer.
DELETE FROM evidence.document_checkpoint WHERE document_id = 'doc-a' AND revision = 3;
SELECT is(pg_temp.texts('00000000-0000-4000-8000-0000000000d1', 'pkg-a', pg_temp.sorted('d', 'e', 'f')), 'd',
  'a removed checkpoint is absent from the next read');

-- C7: the web role, with a session, cannot call it; neither the web role nor
-- the worker reads the checkpoint table directly.
SELECT is(pg_temp.ask('ana', format('SELECT count(*) FROM app.worker_package_checkpoints(%L::uuid, %L, %L::text[])',
    '00000000-0000-4000-8000-0000000000d1', 'pkg-a', pg_temp.sorted('d'))),
  '42501: permission denied for function worker_package_checkpoints', 'the web role cannot read checkpoints');
SELECT matches(pg_temp.worker('SELECT count(*) FROM evidence.document_checkpoint'), '^42501: ',
  'the worker cannot read evidence.document_checkpoint directly');
SELECT matches(pg_temp.ask('ana', 'SELECT count(*) FROM evidence.document_checkpoint'), '^42501: ',
  'the web role cannot read evidence.document_checkpoint directly');

SELECT * FROM finish();
ROLLBACK;
