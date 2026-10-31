-- Mentorships for the DAN-349 tests (#916), on top of fixtures/institution.inc,
-- which must be included first. Every person, work and rule below is invented.
--
--   ms1: Marko, teacher of K2 and of no course of Ana, mentors Ana's master
--        thesis; its assignment zm1 is at version 1, which Ana acknowledged
--   ms2: Vesna mentored Dora's bachelor thesis; ended; zm2, acknowledged
--   ms3: Nina, whose teacher role nobody confirmed, mentors Boris's master
--        thesis; zm3, not acknowledged
--   fak-a has the faculty's rule for master and bachelor theses, fak-b none.
INSERT INTO ref VALUES
  ('ms1', '00000000-0000-4000-8000-0000000000d1'),
  ('ms2', '00000000-0000-4000-8000-0000000000d2'),
  ('ms3', '00000000-0000-4000-8000-0000000000d3'),
  ('ms4', '00000000-0000-4000-8000-0000000000d4'),
  ('zm1', '00000000-0000-4000-8000-0000000000b1'),
  ('zm2', '00000000-0000-4000-8000-0000000000b2'),
  ('zm3', '00000000-0000-4000-8000-0000000000b3'),
  ('zm4', '00000000-0000-4000-8000-0000000000b4');

INSERT INTO institution.faculty_work_rule (institution_id, work_type, ai_policy, ai_purposes, evidence_profile, import_allowed)
VALUES (pg_temp.id('fak_a'), 'master_thesis', 'partially_allowed', '{proofreading,literature_search}', 'extended', false),
       (pg_temp.id('fak_a'), 'bachelor_thesis', 'prohibited', '{}', 'basic', false);

-- The operator writes a mentorship; confirmed_by stays null (#916).
INSERT INTO institution.mentorship (id, institution_id, mentor_id, student_id, work_type, started_at, ended_at)
SELECT pg_temp.id(m.name), s.institution_id, pg_temp.id(m.mentor), s.id, m.work_type,
       now() - m.started_ago, now() - m.ended_ago
FROM (VALUES
  ('ms1', 'marko', 'ana', 'master_thesis', interval '30 days', NULL::interval),
  ('ms2', 'vesna', 'dora', 'bachelor_thesis', interval '60 days', interval '1 day'),
  ('ms3', 'nina', 'boris', 'master_thesis', interval '10 days', NULL)
) AS m (name, mentor, student, work_type, started_ago, ended_ago)
JOIN person s ON s.name = m.student;

-- The rules of each work: an assignment of the mentorship, with no course.
INSERT INTO institution.assignment (id, mentorship_id, institution_id, current_version, created_by)
SELECT pg_temp.id(a.name), m.id, m.institution_id, 1, m.mentor_id
FROM (VALUES ('zm1', 'ms1'), ('zm2', 'ms2'), ('zm3', 'ms3')) AS a (name, mentorship)
JOIN institution.mentorship m ON m.id = pg_temp.id(a.mentorship);
INSERT INTO institution.assignment_version (
  assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
  evidence_profile, import_allowed, created_by
)
SELECT a.id, 1, upper(v.name), 'Upute za izmišljeni mentorski rad.', m.work_type, now(), now() + interval '365 days',
       v.ai_policy, v.ai_purposes::text[], v.evidence_profile, false, m.mentor_id
FROM (VALUES
  ('zm1', 'partially_allowed', '{proofreading}', 'extended'),
  ('zm2', 'prohibited', '{}', 'basic'),
  ('zm3', 'prohibited', '{}', 'basic')
) AS v (name, ai_policy, ai_purposes, evidence_profile)
JOIN institution.assignment a ON a.id = pg_temp.id(v.name)
JOIN institution.mentorship m ON m.id = a.mentorship_id;
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
SELECT a.id, 1, pg_temp.id(n.student), a.institution_id
FROM (VALUES ('zm1', 'ana'), ('zm2', 'dora')) AS n (name, student)
JOIN institution.assignment a ON a.id = pg_temp.id(n.name);
