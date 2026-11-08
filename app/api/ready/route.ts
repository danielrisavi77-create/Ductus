import { withActor } from "@/server/db";
import { evidenceIngestDeps } from "@/server/evidence/ingest-deps";
import { STORAGE_NOT_CONFIGURED } from "@/server/evidence/payload-reader";
import {
  CAPABILITY_TIMEOUT_MS,
  checkCapabilities,
  classifyQueue,
  classifyStorage,
  signingOutcome,
  singleFlight,
  type Capability,
} from "@/server/ready";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

// The database cancels a probe query at its limit, so a hanging probe hands
// its connection back to the pool instead of holding it (DAN-585).
const STATEMENT_LIMIT_SQL = "SELECT pg_catalog.set_config('statement_timeout', $1, true)";

// The worker queue (pg-boss) is reached only by ductus_worker; the web role
// gets nothing in its schema (20261108110200_pgboss_access.sql). Readiness
// therefore reads only the catalogue: no login that inherits ductus_worker is
// "nije_konfigurirano", such a login connected to this database is "ok",
// otherwise the worker is not there to take jobs. Of another role's session
// the web role sees only fields like usename and datname, and a background
// process shows both as NULL; such a row matches nothing here.
const QUEUE_SQL = `SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolcanlogin AND NOT r.rolsuper AND pg_catalog.pg_has_role(r.oid, 'ductus_worker', 'USAGE')
  ) THEN 'nije_konfigurirano'
  WHEN EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_roles r ON r.rolname = a.usename
    WHERE a.datname = pg_catalog.current_database()
      AND r.rolcanlogin AND NOT r.rolsuper AND pg_catalog.pg_has_role(r.oid, 'ductus_worker', 'USAGE')
  ) THEN 'ok'
  ELSE 'nedostupno' END AS queue`;

function inDatabase<T>(timeoutMs: number, sql: string, read: (rows: unknown[]) => T): Promise<T> {
  return withActor(null, async (tx) => {
    await tx.query(STATEMENT_LIMIT_SQL, [`${timeoutMs}ms`]);
    return read((await tx.query(sql)).rows);
  });
}

// withActor cannot be cancelled, so a probe past its limit can still hold a
// pool connection until the pool's query limit ends it. Calls that arrive
// meanwhile wait on that same probe under their own limit, so readiness never
// holds more than one connection per database probe (DAN-585).
const databaseProbe = singleFlight(() => inDatabase(CAPABILITY_TIMEOUT_MS.database, "SELECT 1", () => "ok" as const));
const queueProbe = singleFlight(() => inDatabase(CAPABILITY_TIMEOUT_MS.queue, QUEUE_SQL, (rows) => classifyQueue(rows[0])));

/**
 * Only the database is required: without it nothing can be served. Storage,
 * signing and the queue are reported, so one shared fault does not take every
 * web replica out of traffic; the routes that need them answer 503 on their own.
 */
function capabilities(): Capability[] {
  return [
    {
      name: "database",
      required: true,
      timeoutMs: CAPABILITY_TIMEOUT_MS.database,
      probe: databaseProbe,
    },
    {
      name: "storage",
      required: false,
      timeoutMs: CAPABILITY_TIMEOUT_MS.storage,
      probe: async () => {
        const { payloads } = evidenceIngestDeps();
        if (payloads === STORAGE_NOT_CONFIGURED) return classifyStorage("not_configured");
        const verifyAll = (payloads as { verifyAll?: () => Promise<Record<string, string>> }).verifyAll;
        if (typeof verifyAll !== "function") throw Object.assign(new Error("storage"), { code: "STORAGE_DOMAIN" });
        return classifyStorage(await verifyAll.call(payloads));
      },
    },
    {
      name: "signing",
      required: false,
      timeoutMs: CAPABILITY_TIMEOUT_MS.signing,
      probe: () => {
        const { signer } = evidenceIngestDeps();
        return signingOutcome(() => signer.publicVerificationKey());
      },
    },
    {
      name: "queue",
      required: false,
      timeoutMs: CAPABILITY_TIMEOUT_MS.queue,
      probe: queueProbe,
    },
  ];
}

/**
 * Readiness per capability (DAN-585). The body carries only closed words per
 * capability, never a message, URL or host; the log carries only closed codes.
 * 503 when a required capability is not "ok".
 */
export async function GET(): Promise<Response> {
  const report = await checkCapabilities(capabilities());
  const body = { status: report.ready ? "ready" : "unavailable", capabilities: report.capabilities };
  if (Object.keys(report.codes).length > 0) console.error("readiness", report.codes);
  return Response.json(body, { status: report.ready ? 200 : 503, headers: HEADERS });
}
