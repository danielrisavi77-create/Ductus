import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

// DAN-289 A1 (contract #756, Codex finding on #763): a submission recorded
// before the closing migration closes its packages when the migration runs,
// since a repeated record_submission inserts nothing and never reaches the
// trigger. pgTAP sees the schema only after every migration; here a database
// of its own is migrated up to the one before, given old rows, and only then
// the migration's up section in one transaction, as dbmate runs it. The old
// rows are written as the compose superuser in replica mode, which skips
// foreign keys and triggers: only the three tables the migration reads matter.
// Every identifier is random or invented.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(ADMIN_URL).hostname)) {
  throw new Error("The migration test runs only against a loopback database (DATABASE_URL).");
}
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const TARGET = "20261026120000_submission_closes_package.sql";

function upSection(file: string) {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down < 0) throw new Error(`${file} is not a dbmate migration`);
  return text.slice(0, down);
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const name = `ductus_close_${randomBytes(6).toString("hex")}`;
let client: pg.Client | undefined;

afterAll(async () => {
  await client?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

describe("the closing migration over submissions recorded before it", () => {
  it("closes the packages of documents already submitted, and only those", async () => {
    await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    client = new pg.Client({ connectionString: url.href });
    await client.connect();
    await client.query("SET ROLE ductus_migrator");
    const earlier = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql") && file < TARGET).sort();
    for (const file of earlier) await client.query(`BEGIN;\n${upSection(file)}\nCOMMIT;`);
    await client.query("RESET ROLE");

    const institution = randomUUID();
    const domain = randomUUID();
    const student = randomUUID();
    const assignments = { submitted: randomUUID(), requested: randomUUID(), untouched: randomUUID() };
    const hash = "d".repeat(64);
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    for (const [kind, assignment] of Object.entries(assignments)) {
      await client.query(
        `INSERT INTO evidence.package (id, institution_id, evidence_domain_id, document_id, project_id, principal_id,
                                       evidence_profile_id, max_payload_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, 'standard-v1', 2097152)`,
        [`pkg-${kind}`, institution, domain, `doc-${kind}`, `project-${kind}`, student],
      );
      if (kind === "untouched") continue;
      const request = randomUUID();
      await client.query(
        `INSERT INTO evidence.submission_request (id, institution_id, assignment_id, assignment_version, project_id,
                                                  document_id, principal_id, revision, content_hash, requested_at)
         VALUES ($1, $2, $3, 1, $4, $5, $6, 1, $7, now())`,
        [request, institution, assignment, `project-${kind}`, `doc-${kind}`, student, hash],
      );
      if (kind === "requested") continue;
      await client.query(
        `INSERT INTO evidence.submission (submission_request_id, institution_id, principal_id, assignment_id,
                                          assignment_version, revision, artifact_hash, requested_at, due_at, recorded_at)
         SELECT id, institution_id, principal_id, assignment_id, 1, 1, content_hash, requested_at,
                requested_at + interval '1 day', requested_at
           FROM evidence.submission_request WHERE id = $1`,
        [request],
      );
    }
    await client.query("COMMIT");
    const before = await client.query<{ id: string; accepts_evidence: boolean }>(
      "SELECT id, accepts_evidence FROM evidence.package ORDER BY id");
    expect(before.rows.map((row) => row.accepts_evidence)).toEqual([true, true, true]);

    await client.query("SET ROLE ductus_migrator");
    await client.query(`BEGIN;\n${upSection(TARGET)}\nCOMMIT;`);
    await client.query("RESET ROLE");

    const after = await client.query<{ id: string; accepts_evidence: boolean }>(
      "SELECT id, accepts_evidence FROM evidence.package ORDER BY id");
    expect(after.rows).toEqual([
      { id: "pkg-requested", accepts_evidence: true },
      { id: "pkg-submitted", accepts_evidence: false },
      { id: "pkg-untouched", accepts_evidence: true },
    ]);
  });
});
