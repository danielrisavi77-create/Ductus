-- Whether an acknowledgment is bound to the notice the student saw (DAN-306,
-- M2.13-P03; contract on #1091, c.6685108734; attack plan #1502). The binding
-- follows the fingerprint and nothing else: whatever an insert names, a row
-- with a fingerprint is bound and one without is legacy_unverified, and no row
-- changes its binding afterwards. The migration of rows written before it and
-- the parallel sessions are in tests/integration/.
-- Synthetic fixtures only (fixtures/institution.inc): the four acknowledgments
-- of the fixture have no fingerprint; Z1 of K1 is at version 2, which Ana
-- acknowledged and Dora has not.
BEGIN;
\ir fixtures/institution.inc
SET LOCAL lc_messages TO 'C';

SELECT plan(50);

-- The binding of one acknowledgment, or "none".
CREATE FUNCTION pg_temp.binding(p_assignment text, p_version integer, p_student text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce((SELECT n.notice_binding FROM institution.notice_acknowledgment n
                    WHERE n.assignment_id = pg_temp.id(p_assignment) AND n.version_no = p_version
                      AND n.student_id = pg_temp.id(p_student)), 'none')
$$;
-- Inserts Boris's acknowledgment of Z1 version 1 as p_role (with
-- session_replication_role p_replication) and returns the stored binding, or
-- "SQLSTATE: message". The row never stays: the subtransaction is rolled back.
-- p_binding is an SQL expression, or null to leave the column out.
CREATE FUNCTION pg_temp.insert_as(p_role text, p_replication text, p_template text, p_fingerprint text,
                                  p_binding text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_assignment uuid := pg_temp.id('z1');
  v_student uuid := pg_temp.id('boris');
  v_institution uuid := pg_temp.id('fak_a');
  v_result text;
BEGIN
  BEGIN
    PERFORM set_config('session_replication_role', p_replication, true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE format(
      'INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id, '
      'notice_template_version, notice_fingerprint%s) VALUES ($1, 1, $2, $3, %s, %s%s) RETURNING notice_binding',
      CASE WHEN p_binding IS NULL THEN '' ELSE ', notice_binding' END, p_template, p_fingerprint,
      CASE WHEN p_binding IS NULL THEN '' ELSE ', ' || p_binding END)
      INTO v_result USING v_assignment, v_student, v_institution;
    RAISE EXCEPTION USING ERRCODE = 'ZX111', MESSAGE = v_result;
  EXCEPTION
    WHEN SQLSTATE 'ZX111' THEN v_result := SQLERRM;
    WHEN OTHERS THEN v_result := SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_result;
END
$$;
CREATE FUNCTION pg_temp.acks() RETURNS bigint
LANGUAGE sql AS $$ SELECT count(*) FROM institution.notice_acknowledgment $$;

-- 1. The column: text, never null, legacy_unverified when nothing says more.
SELECT has_column('institution', 'notice_acknowledgment', 'notice_binding', 'notice_binding exists');
SELECT col_type_is('institution', 'notice_acknowledgment', 'notice_binding', 'text', 'notice_binding is text');
SELECT col_not_null('institution', 'notice_acknowledgment', 'notice_binding', 'notice_binding is never null');
SELECT col_default_is('institution', 'notice_acknowledgment', 'notice_binding', 'legacy_unverified'::text,
                      'notice_binding defaults to legacy_unverified');

-- 2. The fixture writes its acknowledgments as the owner role, without a
-- fingerprint: nobody can say which notice they confirmed.
SELECT is(
  (SELECT string_agg(z.name || '.' || n.version_no || '.' || p.name || '.' || n.notice_binding, ' '
                     ORDER BY z.name, n.version_no, p.name)
     FROM institution.notice_acknowledgment n JOIN ref z ON z.val = n.assignment_id::text
     JOIN person p ON p.id = n.student_id),
  'z1.1.ana.legacy_unverified z1.1.dora.legacy_unverified z1.2.ana.legacy_unverified z3.1.tomo.legacy_unverified',
  'every acknowledgment of the fixture is legacy_unverified'
);

-- 3. Input classes (contract a): the four ways a row can hold a template
-- version and a fingerprint, each with every binding a writer can name. The
-- binding is the one the fingerprint gives; a half-filled row is refused.
SELECT matches(
  pg_temp.insert_as('ductus_identity', 'origin', c.template, c.fingerprint, b.binding),
  c.expected,
  'owner role, ' || c.what || ', binding ' || coalesce(btrim(b.binding), 'left out') || ': ' || c.outcome
)
FROM (VALUES
  (1, 'no template version and no fingerprint', 'NULL', 'NULL', '^legacy_unverified$', 'legacy_unverified'),
  (2, 'template version 1 and a fingerprint', '1', $$ repeat('a', 64) $$, '^bound$', 'bound'),
  (3, 'a template version without a fingerprint', '1', 'NULL', '^23514: ', 'refused'),
  (4, 'a fingerprint without a template version', 'NULL', $$ repeat('a', 64) $$, '^23514: ', 'refused')
) AS c (n, what, template, fingerprint, expected, outcome)
CROSS JOIN (VALUES
  (1, NULL), (2, $$ 'bound' $$), (3, $$ 'legacy_unverified' $$), (4, 'NULL'), (5, $$ 'verified' $$)
) AS b (n, binding)
ORDER BY c.n, b.n;

-- 4. An insert that skips the triggers (replica mode, as a restore would) is
-- held to the fingerprint by the CHECK alone.
SELECT matches(
  pg_temp.insert_as(current_user, 'replica', c.template, c.fingerprint, c.binding),
  c.expected,
  'replica mode, ' || c.what
)
FROM (VALUES
  (1, 'no fingerprint, binding left out: legacy_unverified', 'NULL', 'NULL', NULL, '^legacy_unverified$'),
  (2, 'a fingerprint, binding bound: bound', '1', $$ repeat('a', 64) $$, $$ 'bound' $$, '^bound$'),
  (3, 'no fingerprint, binding bound: refused', 'NULL', 'NULL', $$ 'bound' $$, '^23514: '),
  (4, 'a fingerprint, binding legacy_unverified: refused', '1', $$ repeat('a', 64) $$, $$ 'legacy_unverified' $$, '^23514: '),
  (5, 'a fingerprint, binding left out: refused', '1', $$ repeat('a', 64) $$, NULL, '^23514: '),
  (6, 'a foreign binding: refused', 'NULL', 'NULL', $$ 'verified' $$, '^23514: ')
) AS c (n, what, template, fingerprint, binding, expected)
ORDER BY c.n;
SELECT is(pg_temp.acks(), 4::bigint, 'none of the trial inserts stayed');

-- 5. The procedure writes a bound row (A1); a repeat over a legacy row is a
-- conflict and leaves it legacy (#1502 answer 1).
SELECT matches(pg_temp.ask('dora', 'SELECT institution.acknowledge_notice({z1}, 2, 1)'), '^[0-9]{4}-',
               'Dora acknowledges version 2 under template version 1');
SELECT is(pg_temp.binding('z1', 2, 'dora'), 'bound', 'Dora''s acknowledgment is bound');
SELECT is(pg_temp.ask('ana', 'SELECT institution.acknowledge_notice({z1}, 2, 1)'), 'ZD409: conflict',
          'Ana: a repeat over her legacy row is a conflict');
SELECT is(pg_temp.binding('z1', 2, 'ana'), 'legacy_unverified', 'Ana''s row stays legacy_unverified');

-- 6. The gate does not change: a legacy_unverified row of the current version
-- still counts (#1502 answer 1).
SELECT is(pg_temp.ask(a.actor, 'SELECT institution.has_acknowledged_current({z1})::text'), 'true',
          a.actor || ': has_acknowledged_current answers true (' || a.why || ')')
FROM (VALUES (1, 'ana', 'legacy_unverified'), (2, 'dora', 'bound')) AS a (n, actor, why)
ORDER BY a.n;

-- 7. Nobody changes a binding (C2): not the owner role, even to the value it
-- has, and not the web process.
SELECT is(pg_temp.ask_as('ductus_identity', 'anon', s.statement), 'ZD403: notice acknowledgment is immutable',
          'the owner role cannot ' || s.what)
FROM (VALUES
  (1, 'make a bound row legacy', $$ UPDATE institution.notice_acknowledgment SET notice_binding = 'legacy_unverified'
                                    WHERE student_id = {dora} AND version_no = 2 $$),
  (2, 'make a legacy row bound', $$ UPDATE institution.notice_acknowledgment SET notice_binding = 'bound'
                                    WHERE student_id = {ana} AND version_no = 2 $$),
  (3, 'write a binding over itself', $$ UPDATE institution.notice_acknowledgment SET notice_binding = notice_binding
                                         WHERE student_id = {ana} AND version_no = 2 $$)
) AS s (n, what, statement)
ORDER BY s.n;
SELECT matches(pg_temp.ask('ana', $$ UPDATE institution.notice_acknowledgment SET notice_binding = 'bound' $$), '^42501: ',
               'ductus_app cannot change a binding');
SELECT is(concat_ws(' ', pg_temp.binding('z1', 2, 'ana'), pg_temp.binding('z1', 2, 'dora'), pg_temp.acks()),
          'legacy_unverified bound 5', 'the refused changes left every row as it was');

-- 8. Who reads the binding: the row rules do not change. The teacher of the
-- assignment reads every acknowledgment of it, a student her own, nobody else
-- any.
SELECT is(
  pg_temp.ask(r.actor, $$ SELECT coalesce(string_agg(n.version_no || '.' || p.name || '.' || n.notice_binding,
             ' ' ORDER BY n.version_no, p.name), 'none')
           FROM institution.notice_acknowledgment n JOIN person p ON p.id = n.student_id
          WHERE n.assignment_id = {z1} $$),
  r.expected, r.actor || ' reads ' || r.why
)
FROM (VALUES
  (1, 'vesna', '1.ana.legacy_unverified 1.dora.legacy_unverified 2.ana.legacy_unverified 2.dora.bound',
   'every binding of Z1 (teacher)'),
  (2, 'dora', '1.dora.legacy_unverified 2.dora.bound', 'her own'),
  (3, 'ana', '1.ana.legacy_unverified 2.ana.legacy_unverified', 'her own'),
  (4, 'boris', 'none', 'nothing (student outside K1)'),
  (5, 'marko', 'none', 'nothing (teacher of another course)'),
  (6, 'petra', 'none', 'nothing (another institution)')
) AS r (n, actor, expected, why)
ORDER BY r.n;

-- 9. Every row's binding is the one its fingerprint gives.
SELECT is_empty(
  $$ SELECT 1 FROM institution.notice_acknowledgment
      WHERE notice_binding <> CASE WHEN notice_fingerprint IS NULL THEN 'legacy_unverified' ELSE 'bound' END $$,
  'every binding follows its fingerprint'
);

SELECT * FROM finish();
ROLLBACK;
