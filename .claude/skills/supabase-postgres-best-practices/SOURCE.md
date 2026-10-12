# Source

Copied unmodified from [supabase/agent-skills](https://github.com/supabase/agent-skills), path `skills/supabase-postgres-best-practices/`, commit `c9be0e931b7930f7d02126d04774d904c381e7d7`, on 2026-10-10 (DAN-96). MIT licence, see `LICENSE`.

Not copied: `CHANGELOG.md`, `references/_contributing.md`, `references/_template.md`.

To update: copy the same paths from a newer commit and change the commit above. Do not edit the copied files in place.

Ductus is plain Postgres, not the Supabase platform: `auth.uid()` and other `auth.*` helpers in the examples do not exist here. Identity comes from `current_actor()`; `docs/BACKEND.md` wins over this skill wherever they differ.
