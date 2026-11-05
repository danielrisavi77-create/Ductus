import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-525 (#1091 c.6644919534 and c.6645346165): the two parts of the
// administrator contract a single pgTAP transaction cannot show. Both
// procedures and the last-administrator check refuse a snapshot older than
// the statement (REPEATABLE READ, SERIALIZABLE), and the check holds the
// institution's advisory lock, so two revocations that would each leave the
// other administrator in office cannot both commit. Only the operator login
// is used; every institution, person and request is invented.
const ADMIN_URL = requireLoopbackDatabaseUrl(
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
  "The administrator test runs only against a loopback database (DATABASE_URL).",
);
const suffix = randomBytes(4).toString("hex");
const faculty = randomUUID();
const people = { iva: randomUUID(), ana: randomUUID(), nova: randomUUID() };
const ids = Object.values(people);
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });

const state = async () => (await admin.query<{ user_id: string; active: boolean }>(
  `SELECT user_id, revoked_at IS NULL AS active FROM institution.institution_role
    WHERE institution_id = $1 AND role = 'admin' ORDER BY user_id, revoked_at NULLS FIRST`, [faculty],
)).rows;
const events = async () => Number((await admin.query(
  "SELECT count(*) FROM audit.teacher_role_event WHERE institution_id = $1", [faculty],
)).rows[0].count);
const code = (promise: Promise<unknown>) => promise.then(() => "ok", (error: { code?: string }) => error.code ?? "?");

async function connect() {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  return client;
}

beforeAll(async () => {
  await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `it-admin-${suffix}`]);
  for (const [name, id] of Object.entries(people)) await admin.query(
    `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, faculty, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}-${suffix}@it-admin.example`],
  );
  for (const id of [people.iva, people.ana]) await admin.query(
    "SELECT institution.appoint_institution_admin($1, $2)", [id, `Zahtjev ${suffix}/2026`],
  );
});

afterAll(async () => {
  // The trail is append-only, for the operator too: only this clean-up steps
  // around its triggers, on its own connection and for this run's rows.
  const cleaner = await connect();
  try {
    await cleaner.query("BEGIN");
    await cleaner.query("SET LOCAL session_replication_role = replica");
    await cleaner.query("DELETE FROM audit.teacher_role_event WHERE institution_id = $1", [faculty]);
    await cleaner.query("DELETE FROM institution.institution_role WHERE institution_id = $1", [faculty]);
    await cleaner.query("DELETE FROM identity.user_account WHERE id = ANY ($1)", [ids]);
    await cleaner.query("DELETE FROM identity.institution WHERE id = $1", [faculty]);
    await cleaner.query("COMMIT");
  } finally {
    await cleaner.end();
  }
  await admin.end();
});

describe("DAN-525 administrator appointment over separate connections", () => {
  it("refuses both procedures and a direct revocation under a snapshot older than the statement", async () => {
    const before = { rows: await state(), events: await events() };
    for (const level of ["REPEATABLE READ", "SERIALIZABLE"]) {
      for (const sql of [
        ["SELECT institution.appoint_institution_admin($1, $2)", [people.nova, "Zahtjev 2/2026"]],
        ["SELECT institution.revoke_institution_admin($1, $2)", [people.iva, "Zahtjev 3/2026"]],
        [`UPDATE institution.institution_role SET revoked_at = now()
           WHERE institution_id = $1 AND user_id = $2 AND role = 'admin' AND revoked_at IS NULL`, [faculty, people.iva]],
      ] as const) {
        const client = await connect();
        try {
          await client.query(`BEGIN ISOLATION LEVEL ${level}`);
          await client.query("SET CONSTRAINTS ALL IMMEDIATE");
          expect(await code(client.query(sql[0], [...sql[1]])), `${level}: ${sql[0]}`).toBe("25000");
        } finally {
          await client.query("ROLLBACK");
          await client.end();
        }
      }
    }
    expect({ rows: await state(), events: await events() }).toEqual(before);
  });

  it("lets only one of two direct revocations commit when each sees the other administrator", async () => {
    const first = await connect();
    const second = await connect();
    try {
      await first.query("BEGIN");
      await first.query("SET CONSTRAINTS ALL IMMEDIATE");
      const revoke = `UPDATE institution.institution_role SET revoked_at = now()
                       WHERE institution_id = $1 AND user_id = $2 AND role = 'admin' AND revoked_at IS NULL`;
      expect(await code(first.query(revoke, [faculty, people.iva]))).toBe("ok");
      await second.query("BEGIN");
      await second.query("SET CONSTRAINTS ALL IMMEDIATE");
      const pid = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const waiting = code(second.query(revoke, [faculty, people.ana]));
      // The second check waits on the institution's advisory lock until the first commits.
      for (let tries = 0; ; tries += 1) {
        const { rows } = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock' AND wait_event = 'advisory'", [pid],
        );
        if (rows.length > 0) break;
        if (tries > 200) throw new Error("the second revocation never waited on the advisory lock");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await first.query("COMMIT");
      expect(await waiting).toBe("ZD409");
      await second.query("ROLLBACK");
    } finally {
      await first.end();
      await second.end();
    }
    expect(await state()).toEqual([
      { user_id: people.iva, active: false },
      { user_id: people.ana, active: true },
    ].sort((a, b) => (a.user_id < b.user_id ? -1 : 1)));
  });
});
