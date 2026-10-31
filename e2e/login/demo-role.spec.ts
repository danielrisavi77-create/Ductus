import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import pg from "pg";

import { createWithActor } from "../../src/server/db/with-actor";
import { appCookie, SESSION_COOKIE, signIn } from "./support";
import { localAppUrl } from "./local-db-url";

// K-3 / DAN-88. This is deliberately NOT the K-4 walk-through: it proves
// the local operator bootstrap prerequisite without pretending F-6 UI exists.
// The CLI reaches only the local compose database; no HTTP or production
// API may turn an OIDC affiliation into a confirmed teacher role.
const PROVISION_SCRIPT = fileURLToPath(new URL("../../scripts/local/provision-teacher.mjs", import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test("synthetic teacher needs explicit local operator provisioning", async ({ page, context, browser }) => {
  const pool = new pg.Pool({ connectionString: localAppUrl(), max: 2 });
  const withActor = createWithActor(pool);
  const studentPage = await browser.newPage();
  try {
    await signIn(page, "/", "Demo nastavnik");
    const teacherToken = (await appCookie(context, SESSION_COOKIE))?.value;
    expect(teacherToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const roleBefore = await withActor(teacherToken, async (tx) => {
      const { rows } = await tx.query<{ active: boolean }>(
        "SELECT institution.actor_has_role('teacher') AS active",
      );
      return rows[0]?.active === true;
    });
    if (!roleBefore) {
      // On a clean CI stack, fake-OIDC 'employee' is not a teacher grant.
      await expect(withActor(teacherToken, async (tx) => tx.query(
        "SELECT institution.create_course($1, $2, $3)",
        ["Kolegij prije potvrde", "2026/2027", "prohibited"],
      ))).rejects.toMatchObject({ code: "ZD403" });
    } else {
      // Local repeated runs are allowed: provision is intentionally idempotent.
      test.info().annotations.push({ type: "existing-demo-role", description: "Teacher role already bootstrapped on local stack" });
    }

    // Provision with the operator's local docker command, not through the
    // application session or a request carrying a user/tenant identifier.
    const grant = () => spawnSync(process.execPath, [PROVISION_SCRIPT], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 128 * 1024,
    });
    for (let i = 0; i < 2; i += 1) {
      const result = grant();
      expect(result.error).toBeUndefined();
      expect(result.status, "Local operator provisioning failed (exit " + result.status + ")").toBe(0);
    }

    const isConfirmed = await withActor(teacherToken, async (tx) => {
      const { rows } = await tx.query<{ active: boolean }>(
        "SELECT institution.actor_has_role('teacher') AS active",
      );
      return rows[0]?.active === true;
    });
    expect(isConfirmed).toBe(true);

    const create = () => withActor(teacherToken, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT institution.create_course($1, $2, $3) AS id",
        ["Sintetički kolegij za K-3", "2026/2027", "prohibited"],
      );
      return rows[0]?.id;
    });
    const id = await create();
    expect(id).toMatch(UUID);
    expect(await create()).toBe(id); // No duplicate course or membership.

    await signIn(studentPage, "/", "Demo studentica");
    const studentToken = (await appCookie(studentPage.context(), SESSION_COOKIE))?.value;
    expect(studentToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(withActor(studentToken, async (tx) => tx.query(
      "SELECT institution.create_course($1, $2, $3)",
      ["Nedopušten studentski kolegij", "2026/2027", "prohibited"],
    ))).rejects.toMatchObject({ code: "ZD403" });
  } finally {
    await studentPage.close();
    await pool.end();
  }
});
