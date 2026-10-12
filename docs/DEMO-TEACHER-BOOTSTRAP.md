# K-3: local-only teacher confirmation for the Ductura demo

This is an **operator action for an invented account**, not production provisioning or AAI authorization. A successful fake OIDC `employee` login does not confer the confirmed `teacher` role required by `institution.create_course`.

1. On an authorized machine with Docker Compose, start the local stack and apply migrations/seed: `pnpm stack:up`, `pnpm db:migrate`, `pnpm db:seed`.
2. Run `pnpm dev` and sign in once through **Demo prijava → Demo nastavnik** at `http://localhost:3000`. This creates the synthetic `identity.user_account`.
3. Run `node scripts/demo/provision-teacher.mjs` from the repository root. It supplies a fixed SQL file through `docker compose exec -T postgres psql` on the container's local Unix socket. It requires the `ductus` local database, the exact `http://localhost:8090` issuer and the known invented account/home organisation. The step is idempotent. If the account has not been created, it **fails**, not silently creates a new identity.
4. Verify with `pnpm test:e2e:login` on the local stack, or let GitHub's `Local stack (compose.yaml)` CI run the same suite. The test proves that without the role the teacher is refused on a clean stack, that the local operator can confer it, and that the student cannot create a course.

This operator command is not called by any Next.js route, migration, production startup, or request handler. **Never run it against a real institution or production system.** The normal faculty role flow continues to require an administrator-confirmed `institution.confirm_teacher_role`. The demo still needs F-6 UI and assignment routes, F-7 enrolment, F-8 server saving, F-9 comments, and F-10 submission before K-4 can be called complete.

The author's Windows host may be unable to run Docker/WSL; the Linux GitHub Actions runner is the validated environment for this step. The suite does not replace canonical independent review and QA. Changes under `db/local` remain subject to D-97 owner approval for their exact PR and head SHA.
