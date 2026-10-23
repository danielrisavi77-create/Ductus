import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestSubmissionReceiptPayloadV2 } from "@/domain/forensics/submission-receipt-v2";

// Independent continuation by codex:qa598web1:qa, same session
// 01a16acc-3f1d-7687-a56d-5d6df1cd30eb. No feature or runner changes.
const SOURCE = "608c320fb30ccdb6748987709059acc61869a1ea";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = join(ROOT, "db/migrations");
const TARGET = "20261023190000_submission_receipt_issuance.sql";
const URL_ADMIN = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(URL_ADMIN).hostname)) {
  throw new Error("QA598 synthetic tests require the existing loopback CI database.");
}
const suffix = randomBytes(6).toString("hex");
const stranger = `qa598_stranger_${suffix}`;
const cluster = new pg.Client({ connectionString: URL_ADMIN });
const databases: string[] = [];
const clients: pg.Client[] = [];
let db: pg.Client;
let dbUrl: string;
let submission: string;
let token: string;
let student: string;
let faculty: string;
let course: string;
let domain: string;

function section(file: string, direction: "up" | "down") {
  const text = readFileSync(join(MIGRATIONS, file), "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down < up || /transaction:false/.test(text)) throw new Error(`Unsupported migration ${file}`);
  return direction === "up" ? text.slice(up, down) : text.slice(down);
}
async function migrate(client: pg.Client, sql: string) {
  await client.query("BEGIN; SET LOCAL ROLE ductus_migrator");
  try { await client.query(sql); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
}
async function freshDatabase(tag: string) {
  const name = `qa598_${tag}_${suffix}`;
  await cluster.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
  databases.push(name);
  const url = new URL(URL_ADMIN); url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect(); clients.push(client);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await migrate(client, section(file, "up"));
  }
  return { client, url: url.href, name };
}
function fixture(path: string): string {
  return readFileSync(path, "utf8").replace(/^\\ir (.+)$/gm, (_, relative: string) => fixture(join(dirname(path), relative.trim())));
}
async function connection() {
  const client = new pg.Client({ connectionString: dbUrl }); await client.connect(); clients.push(client); return client;
}
async function actor(client: pg.Client) {
  await client.query("BEGIN; SET LOCAL ROLE ductus_app");
  await client.query("SELECT set_config('app.session_token',$1,true)", [token]);
}
const prepare = (client: pg.Client, key: string) => client.query(
  "SELECT * FROM app.prepare_submission_receipt($1,$2,'1')", [submission, key],
);
async function newKey(ends = false) {
  const key = `qa598-${randomBytes(6).toString("hex")}`;
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), randomBytes(32)]).toString("base64url");
  await db.query(`INSERT INTO evidence.signing_key
    (key_id,key_version,evidence_domain_id,institution_id,purpose,algorithm,key_base64url,valid_from,valid_to)
    VALUES($1,'1',$2,$3,'receipt','Ed25519',$4,date_trunc('minute',clock_timestamp())-interval '1 day',
      CASE WHEN $5 THEN date_trunc('minute',clock_timestamp())+interval '1 minute' END)`, [key, domain, faculty, spki, ends]);
  return key;
}
async function count(key: string) {
  return (await db.query("SELECT count(*)::int AS n FROM evidence.submission_receipt_issuance WHERE key_id=$1", [key])).rows[0].n;
}
async function waitForLock(client: pg.Client) {
  // Backend PID is queried before submitting a blocking statement, not via
  // that connection while it is blocked.
  const pid = pids.get(client);
  if (!pid) throw new Error("Missing waiter PID");
  for (let n = 0; n < 200; n++) {
    const row = (await db.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0];
    if (row?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("No observed database lock wait");
}
const pids = new Map<pg.Client, number>();
async function raceClient() {
  const client = await connection(); pids.set(client, (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid); return client;
}

beforeAll(async () => {
  const actual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["rev-parse", `${SOURCE}^{tree}`], { cwd: ROOT, encoding: "utf8" }).trim();
  expect(tree).toBe("28e8ef566fe211f53158e2d510684ee4b9e61c5b");
  const delta = execFileSync("git", ["diff", "--name-status", SOURCE, "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
  expect(delta.sort()).toEqual([
    "A\tdb/tests/064-qa598web1-adversarial.sql",
    "A\ttests/integration/qa598web1-issuance.integration.test.ts",
  ].sort());
  console.info("QA598 SOURCE/HARNESS", JSON.stringify({ source: SOURCE, actual, tree, delta }));
  await cluster.connect();
  const created = await freshDatabase("race"); db = created.client; dbUrl = created.url;
  await db.query("BEGIN");
  // Only give the fixture's temporary stranger a unique cluster role name;
  // the checked-in fixture itself and all product code stay byte-identical.
  await db.query(fixture(join(ROOT, "db/tests/fixtures/evidence-acceptance.inc")).replaceAll("ductus_test_stranger", stranger));
  expect((await db.query("SELECT pg_temp.call('ana','pkg-a','qa598-segment',pg_temp.descriptor(),0,repeat('a',64),repeat('d',64),repeat('b',64)) AS o")).rows[0].o).toBe("reserved");
  expect((await db.query("SELECT pg_temp.ask('ana',$$SELECT outcome FROM app.request_submission('doc-a',1)$$) AS o")).rows[0].o).toBe("requested");
  expect((await db.query("SELECT pg_temp.ask('ana',format('SELECT outcome FROM app.record_submission((SELECT id FROM evidence.submission_request),%L)',pg_temp.h('d'))) AS o")).rows[0].o).toBe("recorded");
  const ids = (await db.query(`SELECT s.id,s.principal_id,s.institution_id,s.assignment_id,
    (SELECT token FROM tok WHERE name='ana') AS token,(SELECT pg_temp.id('k1')) AS course,
    (SELECT evidence_domain_id FROM evidence.package WHERE id='pkg-a') AS domain FROM evidence.submission s`)).rows[0];
  ({ id: submission, principal_id: student, institution_id: faculty, token, course, domain } = ids);
  await db.query("COMMIT");
  console.info("QA598 isolated Postgres", (await db.query("SELECT version() AS version")).rows[0].version);
}, 90_000);

afterAll(async () => {
  for (const client of clients) { try { await client.query("ROLLBACK"); } finally { await client.end(); } }
  for (const name of databases) await cluster.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await cluster.query(`DROP ROLE IF EXISTS ${stranger}`);
  const left = (await cluster.query("SELECT datname FROM pg_database WHERE datname = ANY($1::text[])", [databases])).rows;
  expect(left).toEqual([]);
  console.info("QA598 CLEANUP", JSON.stringify({ databasesDropped: databases.length, remaining: left.length }));
  await cluster.end();
}, 30_000);

describe("QA598 independent issuance runtime", () => {
  it("compares exact DB UTF-8 to real v2 JCS/digest and preserves first attempt on retry", async () => {
    const key = await newKey(); const client = await connection();
    const original = (await db.query("SELECT row_to_json(s)::text AS j FROM evidence.submission s")).rows;
    await actor(client); await client.query("SET LOCAL TIME ZONE 'Pacific/Chatham'");
    const a = (await prepare(client, key)).rows[0]; expect(a.outcome).toBe("prepared");
    const payload = JSON.parse(a.receipt_payload);
    const digest = await digestSubmissionReceiptPayloadV2(payload);
    expect(digest.canonical).toBe(a.receipt_payload); expect(digest.sha256).toBe(a.payload_digest_sha256);
    expect(digest.signingInput.byteLength).toBe(61); expect(Object.keys(payload)).toHaveLength(16);
    expect(payload.signedAt >= payload.requestedAt).toBe(true);
    expect(payload.afterDeadline).toBe(payload.requestedAt > payload.dueAt);
    await client.query("COMMIT");
    const first = (await db.query("SELECT row_to_json(i)::text AS j FROM evidence.submission_receipt_issuance i WHERE id=$1", [a.issuance_id])).rows;
    await actor(client); const b = (await prepare(client, key)).rows[0]; await client.query("COMMIT");
    expect(b.outcome).toBe("prepared"); expect(b.issuance_id).not.toBe(a.issuance_id);
    expect((await db.query("SELECT row_to_json(i)::text AS j FROM evidence.submission_receipt_issuance i WHERE id=$1", [a.issuance_id])).rows).toEqual(first);
    expect((await db.query("SELECT row_to_json(s)::text AS j FROM evidence.submission s")).rows).toEqual(original);
    console.info("QA598 DB-JCS PASS", JSON.stringify({ fields: 16, signingBytes: 61, digest: digest.sha256, attempts: await count(key) }));
  });

  it("rechecks a key revoked while prepare is actually waiting on its row lock", async () => {
    const key = await newKey(); const locker = await raceClient(); const waiter = await raceClient();
    await locker.query("BEGIN"); await locker.query("UPDATE evidence.signing_key SET revoked_at=clock_timestamp() WHERE key_id=$1", [key]);
    await actor(waiter); const pending = prepare(waiter, key); await waitForLock(waiter);
    await locker.query("COMMIT"); const result = (await pending).rows[0]; await waiter.query("COMMIT");
    expect(result).toEqual({ outcome: "key_unavailable", issuance_id: null, receipt_payload: null, payload_digest_sha256: null });
    expect(await count(key)).toBe(0); console.info("QA598 REVOCATION-WAIT PASS observed Lock; 0 attempts");
  });

  it("detects local RLS, FORCE, INSERT and PUBLIC EXECUTE mutants and rolls each back", async () => {
    await db.query("BEGIN; GRANT USAGE ON SCHEMA evidence TO ductus_app");
    const foreignRead = "SELECT pg_temp.ask('dora',$$SELECT count(*)::text FROM evidence.submission_receipt_issuance$$) AS n";
    expect((await db.query(foreignRead)).rows[0].n).toBe("0");
    await db.query("ALTER TABLE evidence.submission_receipt_issuance DISABLE ROW LEVEL SECURITY");
    expect(Number((await db.query(foreignRead)).rows[0].n)).toBeGreaterThan(0);
    await db.query("ROLLBACK");
    await db.query("BEGIN; DROP POLICY submission_receipt_issuance_owner ON evidence.submission_receipt_issuance");
    const ownerRead = "SELECT pg_temp.ask_as('ductus_evidence','ana',$$SELECT count(*)::text FROM evidence.submission_receipt_issuance$$) AS n";
    expect((await db.query(ownerRead)).rows[0].n).toBe("0");
    await db.query("ALTER TABLE evidence.submission_receipt_issuance NO FORCE ROW LEVEL SECURITY");
    expect(Number((await db.query(ownerRead)).rows[0].n)).toBeGreaterThan(0);
    await db.query("ROLLBACK");
    const insert = "SELECT has_table_privilege('ductus_app','evidence.submission_receipt_issuance','INSERT') AS allowed";
    expect((await db.query(insert)).rows[0].allowed).toBe(false);
    await db.query("BEGIN; GRANT INSERT ON evidence.submission_receipt_issuance TO ductus_app");
    expect((await db.query(insert)).rows[0].allowed).toBe(true); await db.query("ROLLBACK");
    const execute = "SELECT has_function_privilege($1,'app.prepare_submission_receipt(uuid,text,text)','EXECUTE') AS allowed";
    expect((await db.query(execute, [stranger])).rows[0].allowed).toBe(false);
    await db.query("BEGIN; GRANT EXECUTE ON FUNCTION app.prepare_submission_receipt(uuid,text,text) TO PUBLIC");
    expect((await db.query(execute, [stranger])).rows[0].allowed).toBe(true); await db.query("ROLLBACK");
    expect((await db.query(insert)).rows[0].allowed).toBe(false);
    expect((await db.query(execute, [stranger])).rows[0].allowed).toBe(false);
    expect((await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='evidence.submission_receipt_issuance'::regclass")).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    console.info("QA598 MUTANTS PASS 4/4 detected; source protections restored by rollback");
  });

  it("uses fresh time after a lock wait crossing validTo, not transaction now", async () => {
    const key = await newKey(true); const locker = await raceClient(); const waiter = await raceClient();
    await locker.query("BEGIN"); await locker.query("SELECT 1 FROM evidence.signing_key WHERE key_id=$1 FOR UPDATE", [key]);
    await actor(waiter);
    const limit = (await db.query("SELECT valid_to FROM evidence.signing_key WHERE key_id=$1", [key])).rows[0].valid_to;
    expect((await waiter.query("SELECT now() < $1::timestamptz AS before", [limit])).rows[0].before).toBe(true);
    const pending = prepare(waiter, key); await waitForLock(waiter);
    await db.query("SELECT pg_sleep(greatest(0,extract(epoch FROM valid_to-clock_timestamp()))+0.03) FROM evidence.signing_key WHERE key_id=$1", [key]);
    await locker.query("COMMIT"); const result = (await pending).rows[0]; await waiter.query("COMMIT");
    expect(result.outcome).toBe("key_unavailable"); expect(await count(key)).toBe(0);
    console.info("QA598 EXPIRY-WAIT PASS transaction started before validTo; lock released after; 0 attempts");
  }, 90_000);

  it("serializes membership removal in both lock orders", async () => {
    const key = await newKey(); const first = await raceClient(); const remover = await raceClient();
    const remove = () => remover.query("UPDATE institution.course_member SET member_to=clock_timestamp() WHERE course_id=$1 AND user_id=$2 AND member_to IS NULL", [course, student]);
    await actor(first); expect((await prepare(first, key)).rows[0].outcome).toBe("prepared");
    await remover.query("BEGIN"); const removing = remove(); await waitForLock(remover);
    await first.query("COMMIT"); await removing; await remover.query("COMMIT");
    await actor(first); expect((await prepare(first, key)).rows[0].outcome).toBe("unauthorized"); await first.query("COMMIT");
    await db.query("INSERT INTO institution.course_member(course_id,institution_id,user_id,role) VALUES($1,$2,$3,'student')", [course, faculty, student]);
    await remover.query("BEGIN"); await remove(); await actor(first);
    const waiting = prepare(first, key); await waitForLock(first); await remover.query("COMMIT");
    expect((await waiting).rows[0].outcome).toBe("unauthorized"); await first.query("COMMIT");
    expect(await count(key)).toBe(1); console.info("QA598 MEMBERSHIP-RACE PASS both observed Lock orders; exactly 1 prior attempt");
  });

  it("restores migrator DOWN/UP and runs the complete pgTAP matrix in a clean private database", async () => {
    const restored = await freshDatabase("restore");
    const before = (await restored.client.query("SELECT pg_get_functiondef('app.prepare_submission_receipt(uuid,text,text)'::regprocedure) AS definition")).rows[0].definition;
    await migrate(restored.client, section(TARGET, "down"));
    expect((await restored.client.query("SELECT to_regclass('evidence.submission_receipt_issuance') AS t, to_regprocedure('app.prepare_submission_receipt(uuid,text,text)') AS f")).rows[0]).toEqual({ t: null, f: null });
    await migrate(restored.client, section(TARGET, "up"));
    expect((await restored.client.query("SELECT pg_get_functiondef('app.prepare_submission_receipt(uuid,text,text)'::regprocedure) AS definition")).rows[0].definition).toBe(before);
    const output = execFileSync("docker", ["compose", "exec", "-T", "postgres", "pg_prove", "-U", "ductus", "-d", restored.name, "--recurse", "--ext", ".sql", "/db/tests"], { cwd: ROOT, encoding: "utf8", timeout: 90_000 });
    expect(output).toContain("Result: PASS"); console.info("QA598 DOWN-UP FULL PGTAP", output);
    const clean = (await restored.client.query("SELECT (SELECT count(*) FROM evidence.submission_receipt_issuance)::int AS attempts,(SELECT count(*) FROM evidence.submission)::int AS submissions,(SELECT count(*) FROM identity.user_account)::int AS accounts")).rows[0];
    expect(clean).toEqual({ attempts: 0, submissions: 0, accounts: 0 });
    const dump = execFileSync("docker", ["compose", "exec", "-T", "postgres", "pg_dump", "-U", "ductus", "-d", restored.name, "--schema-only"], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
    expect(dump).toContain("submission_receipt_issuance");
    console.info("QA598 RESTORE CLEAN", JSON.stringify({ ...clean, schemaSha256: createHash("sha256").update(dump).digest("hex") }));
  }, 120_000);
});
