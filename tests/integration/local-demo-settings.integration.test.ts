import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { expect, it } from "vitest";

import { createWithActor } from "@/server/db/with-actor";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const APP_URL = process.env.APP_DATABASE_URL ?? "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus";
const DEMO_SLUG = "demo-fakultet";
const OTHER_SLUG = "demo-bez-prijave";
const root = fileURLToPath(new URL("../../", import.meta.url));
const seed = readFileSync(new URL("../../db/local/seed.sql", import.meta.url));

function requireLocalStack() {
  for (const [name, value, user] of [["DATABASE_URL", ADMIN_URL, "ductus"], ["APP_DATABASE_URL", APP_URL, "ductus_app_local"]]) {
    const url = new URL(value);
    if (url.protocol !== "postgres:" || url.hostname !== "127.0.0.1" || url.port !== "54329" ||
        url.pathname !== "/ductus" || url.username !== user || url.search || url.hash) {
      throw new Error(`${name} must target the local Compose database`);
    }
  }
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT || process.env.COMPOSE_FILE ||
      (process.env.COMPOSE_PROJECT_NAME && process.env.COMPOSE_PROJECT_NAME !== "ductus")) {
    throw new Error("The demo seed test requires the local ductus Compose project");
  }
  const context = execFileSync("docker", ["context", "show"], { encoding: "utf8" }).trim();
  if (context !== "default" && context !== "desktop-linux") {
    throw new Error("The demo seed test requires a local Docker context");
  }
  const endpoint = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8" }).trim();
  if (!endpoint.startsWith("unix://") && !endpoint.startsWith("npipe://")) {
    throw new Error("The demo seed test requires a local Docker socket");
  }
}

function runSeed() {
  // This is the db:seed command and its actual file, run outside any SQL transaction.
  execFileSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "ductus", "-d", "ductus", "-v", "ON_ERROR_STOP=1", "-q"],
    { cwd: root, input: seed, stdio: ["pipe", "pipe", "pipe"] });
}

type Settings = { institution_id: string; display_name: string; enrollment_attempt_limit: number;
  enrollment_attempt_window: string; updated_at: Date };

it("seeds only the local demo settings and preserves configuration and enrollment state on rerun", async () => {
  requireLocalStack();
  const admin = new pg.Pool({ connectionString: ADMIN_URL });
  const app = new pg.Pool({ connectionString: APP_URL });
  const withActor = createWithActor(app);
  const suffix = randomBytes(5).toString("hex");
  const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const tokens = users.map(() => randomBytes(32).toString("base64url"));
  let demoId = "";
  let otherId = "";
  let courseId = "";
  let original: Settings | undefined;
  try {
    // CI runs demo:prepare first. Remove only this synthetic row to model a
    // freshly migrated stack, then restore its original value in finally.
    const institutions = await admin.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM identity.institution WHERE slug = ANY($1)", [[DEMO_SLUG, OTHER_SLUG]]);
    demoId = institutions.rows.find((row) => row.slug === DEMO_SLUG)?.id ?? "";
    otherId = institutions.rows.find((row) => row.slug === OTHER_SLUG)?.id ?? "";
    expect(demoId).toBeTruthy();
    expect(otherId).toBeTruthy();
    const existing = await admin.query<Settings>(
      "SELECT institution_id, display_name, enrollment_attempt_limit, enrollment_attempt_window::text, updated_at FROM institution.institution_settings WHERE institution_id = $1", [demoId]);
    original = existing.rows[0];
    await admin.query("DELETE FROM institution.institution_settings WHERE institution_id = $1", [demoId]);
    expect((await admin.query("SELECT 1 FROM institution.institution_settings WHERE institution_id = $1", [demoId])).rowCount).toBe(0);

    runSeed();
    const seeded = await admin.query<Settings>(
      "SELECT institution_id, display_name, enrollment_attempt_limit, enrollment_attempt_window::text, updated_at FROM institution.institution_settings WHERE institution_id = $1", [demoId]);
    expect(seeded.rows).toHaveLength(1);
    expect(seeded.rows[0].display_name).toBe("Demo fakultet (test)");
    expect(seeded.rows[0].enrollment_attempt_limit).toBe(5);
    expect(seeded.rows[0].enrollment_attempt_window).toBe("00:15:00");
    expect((await admin.query("SELECT count(*)::int AS n FROM institution.institution_settings WHERE institution_id = $1", [otherId])).rows[0].n).toBe(0);

    for (let i = 0; i < users.length; i += 1) {
      await admin.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [users[i], i === 4 ? otherId : demoId, `https://issuer-${suffix}.test`, `student-${i}`, `student-${i}@seed-${suffix}.test`]);
      await admin.query(
        `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
         VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
        [tokens[i], users[i], i === 4 ? otherId : demoId]);
    }
    await admin.query(
      "INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at) VALUES ($1, $2, 'admin', now())",
      [demoId, users[0]]);
    await withActor(tokens[0], (tx) => tx.query("SELECT institution.confirm_teacher_role($1)", [users[1]]));
    courseId = (await withActor(tokens[1], async (tx) =>
      (await tx.query<{ id: string }>(
        "SELECT institution.create_course('Sinteticki kolegij', '2026/2027', 'prohibited') AS id")).rows[0].id));
    const code = await withActor(tokens[1], async (tx) =>
      (await tx.query<{ code: string }>(
        "SELECT institution.create_enrollment_code($1, now() + interval '1 day') AS code", [courseId])).rows[0].code);
    const wrong = await withActor(tokens[3], async (tx) =>
      (await tx.query<{ outcome: string }>("SELECT outcome FROM institution.enroll_with_code('WRONGCODE')")).rows[0].outcome);
    expect(wrong).toBe("refused");
    const attempt = (await admin.query<{ id: string }>(
      "SELECT id FROM institution.enrollment_attempt WHERE user_id = $1", [users[3]])).rows[0].id;

    await admin.query(
      `UPDATE institution.institution_settings SET display_name = 'Prilagodeni demo (test)',
         enrollment_attempt_limit = 7, enrollment_attempt_window = '20 minutes' WHERE institution_id = $1`, [demoId]);
    runSeed();
    const preserved = await admin.query<Settings>(
      "SELECT institution_id, display_name, enrollment_attempt_limit, enrollment_attempt_window::text, updated_at FROM institution.institution_settings WHERE institution_id = $1", [demoId]);
    expect(preserved.rows).toHaveLength(1);
    expect(preserved.rows[0].display_name).toBe("Prilagodeni demo (test)");
    expect(preserved.rows[0].enrollment_attempt_limit).toBe(7);
    expect(preserved.rows[0].enrollment_attempt_window).toBe("00:20:00");
    expect((await admin.query("SELECT id FROM institution.enrollment_attempt WHERE user_id = $1", [users[3]])).rows[0].id).toBe(attempt);
    expect((await admin.query("SELECT count(*)::int AS n FROM identity.user_account WHERE id = ANY($1)", [users])).rows[0].n).toBe(5);
    expect((await admin.query("SELECT count(*)::int AS n FROM identity.session WHERE user_id = ANY($1)", [users])).rows[0].n).toBe(5);

    const enrolled = await withActor(tokens[2], async (tx) =>
      (await tx.query<{ outcome: string; enrolled_course_id: string }>(
        "SELECT outcome, enrolled_course_id FROM institution.enroll_with_code($1)", [code])).rows[0]);
    expect(enrolled).toEqual({ outcome: "enrolled", enrolled_course_id: courseId });
    await expect(withActor(tokens[4], (tx) => tx.query(
      "SELECT outcome FROM institution.enroll_with_code($1)", [code]))).rejects.toMatchObject({ code: "ZD503" });
    runSeed();
    expect((await admin.query("SELECT count(*)::int AS n FROM institution.course_member WHERE course_id = $1 AND user_id = $2", [courseId, users[2]])).rows[0].n).toBe(1);
    expect((await admin.query("SELECT count(*)::int AS n FROM institution.enrollment_attempt WHERE id = $1", [attempt])).rows[0].n).toBe(1);
    expect((await admin.query("SELECT count(*)::int AS n FROM institution.institution_settings WHERE institution_id = $1", [demoId])).rows[0].n).toBe(1);
    expect((await admin.query("SELECT count(*)::int AS n FROM institution.institution_settings WHERE institution_id = $1", [otherId])).rows[0].n).toBe(0);
  } finally {
    if (courseId) {
      await admin.query("DELETE FROM institution.course_member WHERE course_id = $1", [courseId]);
      await admin.query("DELETE FROM institution.course_enrollment_code WHERE course_id = $1", [courseId]);
      await admin.query("DELETE FROM institution.course WHERE id = $1", [courseId]);
    }
    await admin.query("DELETE FROM institution.enrollment_attempt WHERE user_id = ANY($1)", [users]);
    await admin.query("DELETE FROM institution.institution_role WHERE user_id = ANY($1)", [users]);
    await admin.query("DELETE FROM identity.session WHERE user_id = ANY($1)", [users]);
    await admin.query("DELETE FROM identity.user_account WHERE id = ANY($1)", [users]);
    if (demoId) {
      await admin.query("DELETE FROM institution.institution_settings WHERE institution_id = $1", [demoId]);
      if (original) {
        await admin.query(
          `INSERT INTO institution.institution_settings
           (institution_id, display_name, enrollment_attempt_limit, enrollment_attempt_window, updated_at)
           VALUES ($1, $2, $3, $4::interval, $5)`,
          [demoId, original.display_name, original.enrollment_attempt_limit,
            original.enrollment_attempt_window, original.updated_at]);
      }
    }
    await app.end();
    await admin.end();
  }
});
