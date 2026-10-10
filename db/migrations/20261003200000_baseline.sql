-- migrate:up
-- Baseline: proves the migration pipeline (dbmate) end to end. Schema,
-- roles and grants arrive in later migrations (B-5, docs/BACKEND.md 3).
SELECT 1;

-- migrate:down
SELECT 1;
