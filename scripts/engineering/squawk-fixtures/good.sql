-- DAN-319 fixture, never applied: the migration lint step lints it on every run
-- and expects exit 0. The down part would fail the lint (ban-drop-column), so
-- this also proves that the rollback part is not linted as forward SQL.
-- migrate:up
SET LOCAL ROLE ductus_migrator;

CREATE TABLE fixture.note (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fixture.note ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fixture.note FROM PUBLIC;

-- squawk-ignore ban-drop-function
DROP FUNCTION fixture.old_label(bigint);

CREATE FUNCTION fixture.note_label(note_id bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT label FROM fixture.note WHERE id = note_id $$;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
ALTER TABLE fixture.other DROP COLUMN label;
DROP TABLE fixture.note;
