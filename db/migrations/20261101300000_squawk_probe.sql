-- migrate:up
-- DAN-319 probe, removed in the next commit: Squawk must fail on it.
SET LOCAL ROLE ductus_migrator;
ALTER TABLE identity.institution ADD COLUMN squawk_probe text NOT NULL;

-- migrate:down
SET LOCAL ROLE ductus_migrator;
ALTER TABLE identity.institution DROP COLUMN squawk_probe;
