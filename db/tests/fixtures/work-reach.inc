-- Probes shared by the group scope tests (099, 100): every surface of a
-- work an actor reaches, every action can() allows and every list of
-- students, each as one line of text. Included with \ir after
-- institution.inc, inside the test's own transaction. The works the probes
-- read carry one checkpoint with the text of pg_temp.text_hash().
CREATE FUNCTION pg_temp.text_hash() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to('Prvi odlomak.', 'UTF8')), 'hex') $$;

-- now() is one instant for the whole test, so time passes by moving every
-- recorded start and end of a work, a group place, a teacher place and a
-- course membership one minute back; the order of the history is kept, and
-- what comes next is later than all of it.
CREATE FUNCTION pg_temp.tick() RETURNS void
LANGUAGE sql AS $$
  UPDATE evidence.project SET created_at = created_at - interval '1 minute';
  UPDATE institution.course_member
     SET member_from = member_from - interval '1 minute', member_to = member_to - interval '1 minute';
  UPDATE institution.seminar_group_member
     SET valid_from = valid_from - interval '1 minute', valid_to = valid_to - interval '1 minute';
  UPDATE institution.seminar_group_teacher
     SET valid_from = valid_from - interval '1 minute', valid_to = valid_to - interval '1 minute';
$$;

-- Every surface of a work the actor reaches, in a fixed order, or "-".
-- text: read_live_state; comments: list_comments; summary and replay: the
-- two sources (no package yet, so "unavailable" when allowed and "not_found"
-- when refused); checkpoints: the replay text; fast_path:
-- record_fast_path_opening, as fast_path_works calls it under the identity
-- role; comment: create_comment (last, it writes).
CREATE FUNCTION pg_temp.reach(p_actor text, p_doc text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(s.name, ',' ORDER BY s.pos), '-')
  FROM (VALUES
    (1, 'text', pg_temp.ask(p_actor, format($q$ SELECT outcome FROM collaboration.read_live_state(%L, %L) $q$,
                                            p_doc, repeat('0', 64))) = 'empty'),
    (2, 'comments', pg_temp.ask(p_actor, format($q$ SELECT count(*)::text FROM collaboration.list_comments(%L) $q$,
                                                p_doc)) ~ '^[0-9]+$'),
    (3, 'summary', pg_temp.ask(p_actor, format($q$ SELECT outcome FROM app.read_process_summary_source(%L) $q$,
                                               p_doc)) = 'unavailable'),
    (4, 'replay', pg_temp.ask(p_actor, format($q$ SELECT outcome FROM app.read_replay_source(%L) $q$,
                                              p_doc)) = 'unavailable'),
    (5, 'checkpoints', pg_temp.ask(p_actor, format(
          $q$ SELECT count(*)::text FROM app.read_replay_checkpoints(%L, ARRAY[%L]) $q$,
          p_doc, pg_temp.text_hash())) = '1'),
    (6, 'fast_path', pg_temp.ask_as('ductus_identity', p_actor, format($q$ SELECT 'ok' FROM app.record_fast_path_opening(%L) $q$,
                                                 p_doc)) = 'ok'),
    (7, 'comment', pg_temp.ask(p_actor, format(
          $q$ SELECT collaboration.create_comment(%L, 'Ovdje nedostaje izvor.', %L::jsonb)::text $q$, p_doc,
          '{"nodeId":"0f0e0d0c-0b0a-4000-8000-000000000001","quote":"Prvi","prefix":"","suffix":" odlomak","startHint":0,"endHint":4}'
        )) ~ '^[0-9a-f-]{36}$')
  ) AS s (pos, name, ok)
  WHERE s.ok
$$;
-- Every action can() allows on the work, or "-".
CREATE FUNCTION pg_temp.can(p_actor text, p_doc text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(a.name, ',' ORDER BY a.pos), '-')
  FROM (VALUES (1, 'read'), (2, 'comment'), (3, 'open_fast_path'), (4, 'write'), (5, 'propose')) AS a (pos, name)
  WHERE pg_temp.ask(p_actor, format('SELECT institution.can(%L, %L)::text', a.name, p_doc)) = 'true'
$$;
-- The first column of a list RPC, with names in place of ids, or "-"; an
-- error comes back as it is.
CREATE FUNCTION pg_temp.list(p_actor text, p_sql text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce((SELECT string_agg(coalesce(p.name, u), ',' ORDER BY coalesce(p.name, u))
                     FROM unnest(string_to_array(r, ',')) u LEFT JOIN person p ON p.id::text = u
                    WHERE r <> '-' AND r !~ '^ZD|^[0-9A-Z]{5}: '), r)
  FROM (SELECT pg_temp.ask(p_actor, 'SELECT coalesce(string_agg(x::text, '',''), ''-'') FROM (' || p_sql || ') q (x)')) t (r)
$$;
CREATE TEMP TABLE lists (pos integer PRIMARY KEY, name text, sql text);
INSERT INTO lists VALUES
  (1, 'course', 'SELECT student_id FROM app.teacher_course_students({k1})'),
  (2, 'names', 'SELECT student_id FROM app.teacher_assignment_names({z1})'),
  (3, 'submissions', 'SELECT student_id FROM app.assignment_submissions({z1})'),
  (4, 'works', 'SELECT document_id FROM app.assignment_works({z1})');
-- app.fast_path_works takes its students from the same
-- app.teacher_assignment_students as names, submissions and works; it needs
-- a signed package to answer at all (085), so it is not asked here.
GRANT SELECT ON lists TO PUBLIC;
-- Every list in one line, "name=who" separated by "; ".
CREATE FUNCTION pg_temp.lists(p_actor text) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(l.name || '=' || pg_temp.list(p_actor, l.sql), '; ' ORDER BY l.pos) FROM lists l
$$;
CREATE FUNCTION pg_temp.all_lists(p_who text, p_works text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT format('course=%1$s; names=%1$s; submissions=%1$s; works=%2$s', p_who, p_works)
$$;
