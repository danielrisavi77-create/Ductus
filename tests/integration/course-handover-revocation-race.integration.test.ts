import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-351 (#1923, repair round 3, review c.6791430880 and QA c.6791430336):
// hand_over_course must not make a revoked teacher the holder. pgTAP runs in
// one transaction and cannot hold two open, so here two real connections race
// a handover against revoke_teacher_role. (a) The revocation runs first and
// stays uncommitted: the handover must wait on the new holder's role row and,
// once the revocation commits, refuse with ZD422 and write nothing. Without
// the row lock the handover does not wait and makes the revoked teacher the
// holder. (b) The handover runs first and stays uncommitted: the revocation
// must wait, and both then commit without a deadlock.
// Loopback only; random synthetic rows, removed afterwards. Every person,
// course and faculty here is invented.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The course handover race test runs only against a loopback database (DATABASE_URL).");
const applicationName = `it_handover_race_${randomBytes(5).toString("hex")}`;
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3, application_name: applicationName });
const withActor = createWithActor(app);
const faculty = randomUUID();
const token = () => randomBytes(32).toString("base64url");
// Two administrators race each other; "holder" names the first holder, the
// two teachers are the targets of one race each.
const roles = { adminA: "admin", adminB: "admin", holder: "teacher", revokedFirst: "teacher", handedFirst: "teacher", student: null } as const;
type Name = keyof typeof roles;
const names = Object.keys(roles) as Name[];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: token() }])) as Record<Name, { id: string; token: string }>;
const ids = Object.values(people).map((person) => person.id);
let course: string;

async function waitForBlocked(pattern: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
          WHERE a.application_name = $1 AND a.state = 'active' AND a.query ILIKE $2
            AND cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
       ) AS blocked`,
      [applicationName, pattern],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No ${pattern} call reached PostgreSQL and waited on the open transaction.`);
}

// Runs one call in its own transaction and keeps it open until release().
function held<T>(session: string, sql: string, values: unknown[]) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let ran!: () => void;
  const started = new Promise<void>((resolve) => { ran = resolve; });
  const done = withActor(session, async (tx) => {
    const rows = (await tx.query<T & pg.QueryResultRow>(sql, values)).rows;
    ran();
    await gate;
    return rows;
  });
  return { started, done, release };
}

const state = async () => ({
  holders: (await admin.query(
    "SELECT user_id, valid_to IS NULL AS open FROM institution.course_holder WHERE course_id = $1 ORDER BY valid_from, valid_to NULLS LAST", [course],
  )).rows,
  handovers: (await admin.query(
    "SELECT from_holder_id, to_holder_id FROM audit.course_handover WHERE course_id = $1 ORDER BY occurred_at", [course],
  )).rows,
  notified: Number((await admin.query(
    "SELECT count(*) FROM institution.notification WHERE institution_id = $1 AND kind = 'course_handover'", [faculty],
  )).rows[0].count),
  revoked: (await admin.query(
    "SELECT user_id FROM institution.institution_role WHERE institution_id = $1 AND role = 'teacher' AND revoked_at IS NOT NULL ORDER BY user_id", [faculty],
  )).rows.map((row) => row.user_id as string),
});

beforeAll(async () => {
  const suffix = randomBytes(6).toString("hex");
  await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `handover-race-${suffix}`]);
  await admin.query("INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmisljeni fakultet primopredaja')", [faculty]);
  for (const name of names) {
    const person = people[name];
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [person.id, faculty, `${suffix}-${name}`, `${suffix}-${name}@handover-race.example`],
    );
    await admin.query(
      "INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at) VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now()+interval '1 hour')",
      [person.token, person.id, faculty],
    );
    // An active administrator comes only from the operator procedure (DAN-525), on an invented request.
    if (roles[name] === "admin") await admin.query("SELECT institution.appoint_institution_admin($1, $2)", [person.id, `Zahtjev ${name}/2026`]);
    if (roles[name] === "teacher") await admin.query(
      "INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at) VALUES ($1, $2, 'teacher', now())", [faculty, person.id],
    );
  }
  course = await withActor(people.holder.token, async (tx) => {
    const id = (await tx.query<{ id: string }>("SELECT institution.create_course('Izmisljeni kolegij primopredaja', '2026/2027', 'prohibited') AS id")).rows[0].id;
    await tx.query("SELECT institution.set_course_holder($1, $2)", [id, people.holder.id]);
    return id;
  });
  for (const [name, role] of [["revokedFirst", "teacher"], ["handedFirst", "teacher"], ["student", "student"]] as const) await admin.query(
    "INSERT INTO institution.course_member (course_id, user_id, institution_id, role) VALUES ($1, $2, $3, $4)", [course, people[name].id, faculty, role],
  );
});

afterAll(async () => {
  await app.end();
  // The audit rows are append-only; only a replica session removes this file's own.
  const cleaner = await admin.connect();
  try {
    await cleaner.query("BEGIN");
    await cleaner.query("SET LOCAL session_replication_role = replica");
    await cleaner.query("DELETE FROM audit.course_handover WHERE institution_id = $1", [faculty]);
    await cleaner.query("DELETE FROM audit.teacher_role_event WHERE institution_id = $1", [faculty]);
    await cleaner.query("COMMIT");
  } finally {
    cleaner.release();
  }
  await admin.query("DELETE FROM institution.notification WHERE institution_id = $1", [faculty]);
  await admin.query("DELETE FROM institution.course_holder WHERE institution_id = $1", [faculty]);
  await admin.query("DELETE FROM institution.course_member WHERE institution_id = $1", [faculty]);
  await admin.query("DELETE FROM institution.course WHERE institution_id = $1", [faculty]);
  await admin.query("DELETE FROM institution.institution_role WHERE institution_id = $1", [faculty]);
  await admin.query("DELETE FROM institution.institution_settings WHERE institution_id = $1", [faculty]);
  await admin.query("DELETE FROM identity.session WHERE user_id = ANY($1)", [ids]);
  await admin.query("DELETE FROM identity.user_account WHERE id = ANY($1)", [ids]);
  await admin.query("DELETE FROM identity.institution WHERE id = $1", [faculty]);
  expect(Number((await admin.query("SELECT count(*) FROM identity.institution WHERE id = $1", [faculty])).rows[0].count)).toBe(0);
  await admin.end();
});

describe("course handover racing a teacher role revocation, two real connections", () => {
  it("waits for an uncommitted revocation and then refuses the revoked teacher, writing nothing", async () => {
    const before = await state();
    const revoke = held<{ revoked: boolean }>(people.adminB.token, "SELECT institution.revoke_teacher_role($1) AS revoked", [people.revokedFirst.id]);
    await revoke.started;
    const handover = withActor(people.adminA.token, (tx) => tx.query("SELECT institution.hand_over_course($1, $2)", [course, people.revokedFirst.id]));
    const outcome = handover.then(() => "committed", (error: { code?: string; message?: string }) => `${error.code} ${error.message}`);
    try {
      await waitForBlocked("%hand_over_course%");
    } finally {
      revoke.release();
    }
    expect((await revoke.done)[0].revoked).toBe(true);
    expect(await outcome).toBe("ZD422 invalid input");
    const after = await state();
    expect(after.holders).toEqual(before.holders);
    expect(after.holders.filter((row) => row.open)).toEqual([{ user_id: people.holder.id, open: true }]);
    expect(after.handovers).toEqual(before.handovers);
    expect(after.notified).toBe(before.notified);
    expect(after.revoked).toEqual([people.revokedFirst.id]);
  });

  it("makes a revocation wait for an uncommitted handover, and both commit without a deadlock", async () => {
    const handover = held<{ id: string }>(people.adminA.token, "SELECT institution.hand_over_course($1, $2) AS id", [course, people.handedFirst.id]);
    await handover.started;
    const revoke = withActor(people.adminB.token, (tx) => tx.query<{ revoked: boolean }>(
      "SELECT institution.revoke_teacher_role($1) AS revoked", [people.handedFirst.id],
    ));
    const outcome = revoke.then((result) => result.rows[0].revoked, (error: { code?: string; message?: string }) => `${error.code} ${error.message}`);
    try {
      await waitForBlocked("%revoke_teacher_role%");
    } finally {
      handover.release();
    }
    expect((await handover.done)[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await outcome).toBe(true);
    const after = await state();
    expect(after.holders.filter((row) => row.open)).toEqual([{ user_id: people.handedFirst.id, open: true }]);
    expect(after.handovers).toEqual([{ from_holder_id: people.holder.id, to_holder_id: people.handedFirst.id }]);
    expect(after.notified).toBe(1);
    expect(after.revoked.sort()).toEqual([people.revokedFirst.id, people.handedFirst.id].sort());
  });
});
