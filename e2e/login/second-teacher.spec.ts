import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import pg from "pg";

import { createWithActor } from "../../src/server/db/with-actor";
import { appCookie, SESSION_COOKIE, sessionRow, signIn } from "./support";

// K-4d prerequisite (#655): "Demo nastavnica" is a second invented teacher of
// the same institution, for the step where a teacher who is not the course's
// teacher cannot read the work. The fake provider only names her; the teacher
// role still comes from the explicit local operator command, and only for the
// two fixed demo teachers (D-09 untouched: local and CI only).
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PROVISION_SCRIPT = fileURLToPath(new URL("../../scripts/demo/provision-teacher.mjs", import.meta.url));
const PROVISION_SQL = fileURLToPath(new URL("../../db/local/provision-demo-teacher.sql", import.meta.url));
const APP_DATABASE_URL =
  process.env.APP_DATABASE_URL ?? "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus";
const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const SECOND_TEACHER = "demo-teacher-2@demo.ductus.test";

async function withAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  if (!["127.0.0.1", "localhost"].includes(new URL(ADMIN_DATABASE_URL).hostname)) {
    throw new Error("the second-teacher check runs only against a local database");
  }
  const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Active teacher-role rows per demo account, read as the local admin. */
const activeTeacherRoles = () => withAdmin(async (client) => Object.fromEntries((await client.query<{ id: string; n: string }>(
  `SELECT u.hr_edu_person_unique_id AS id, count(r.id) AS n FROM identity.user_account u
     LEFT JOIN institution.institution_role r ON r.user_id = u.id AND r.role = 'teacher' AND r.revoked_at IS NULL
    WHERE u.hr_edu_person_unique_id LIKE '%@demo.ductus.test' GROUP BY u.hr_edu_person_unique_id`)).rows
  .map((row) => [row.id, Number(row.n)])));

const provision = (args: string[]) => spawnSync(process.execPath, [PROVISION_SCRIPT, ...args], {
  cwd: ROOT, encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024,
});

let grantedByThisTest = false;
test.afterEach(async () => {
  if (!grantedByThisTest) return;
  await withAdmin((client) => client.query(
    `UPDATE institution.institution_role r SET revoked_at = now() FROM identity.user_account u
      WHERE r.user_id = u.id AND u.hr_edu_person_unique_id = $1 AND r.role = 'teacher'
        AND r.revoked_at IS NULL AND r.confirmed_by IS NULL`, [SECOND_TEACHER]));
  grantedByThisTest = false;
});

test("the second synthetic teacher signs in and gets a role only from the local operator", async ({ page, context }) => {
  const pool = new pg.Pool({ connectionString: APP_DATABASE_URL, max: 2 });
  const withActor = createWithActor(pool);
  try {
    await signIn(page, "/", "Demo nastavnica");
    const token = (await appCookie(context, SESSION_COOKIE))?.value;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await sessionRow(token!)).toMatchObject({ institution: "demo-fakultet", unique_id: SECOND_TEACHER, closed_at: null });
    const hasRole = () => withActor(token!, async (tx) =>
      (await tx.query<{ active: boolean }>("SELECT institution.actor_has_role('teacher') AS active")).rows[0]?.active === true);

    const before = await activeTeacherRoles();
    grantedByThisTest = !(await hasRole());
    if (grantedByThisTest) {
      // The 'employee' affiliation alone is no teacher grant.
      await expect(withActor(token!, (tx) => tx.query("SELECT institution.create_course($1, $2, $3)",
        ["Kolegij prije potvrde nastavnice", "2026/2027", "prohibited"]))).rejects.toMatchObject({ code: "ZD403" });
    }

    // Anything but the two fixed teachers is refused before Docker runs.
    for (const args of [["demo-student"], ["demo-teacher-2", "demo-student"], ["Demo nastavnica"]]) {
      const refused = provision(args);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("accepts no argument or one of: demo-teacher-2");
    }
    // The SQL holds the same list when it is fed another account directly.
    const direct = spawnSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
      "-v", "account=demo-student", "-U", "ductus", "-d", "ductus"], {
      cwd: ROOT, input: readFileSync(PROVISION_SQL, "utf8"), encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024,
    });
    expect(direct.error).toBeUndefined();
    expect(direct.status).not.toBe(0);
    expect(direct.stderr).toContain("unknown demo teacher account");
    expect(await activeTeacherRoles()).toEqual(before);

    for (let i = 0; i < 2; i += 1) {
      const granted = provision(["demo-teacher-2"]);
      expect(granted.error).toBeUndefined();
      expect(granted.status, `local operator provisioning failed (exit ${granted.status})`).toBe(0);
    }
    expect(await hasRole()).toBe(true);
    // Only her row changed: the first teacher and the students are as they were.
    expect(await activeTeacherRoles()).toEqual({ ...before, [SECOND_TEACHER]: 1 });
  } finally {
    await pool.end();
  }
});
