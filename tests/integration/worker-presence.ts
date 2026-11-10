import pg from "pg";

// /api/ready reports the queue as ok while any login that inherits
// ductus_worker is connected. The integration files run side by side, so a
// file that opens such a session and the file that reads the capability take
// this session lock in turn: neither sees the other's worker.
const WORKER_PRESENCE_LOCK = "5170585";

/** Waits for the lock on a session of its own and returns the function that gives it back. */
export async function holdWorkerPresence(adminUrl: string): Promise<() => Promise<void>> {
  // Not a pool: a pool closes an idle client, and the lock would go with it.
  const client = new pg.Client({ connectionString: adminUrl, application_name: "it-worker-presence" });
  await client.connect();
  try {
    await client.query("SELECT pg_catalog.pg_advisory_lock($1::bigint)", [WORKER_PRESENCE_LOCK]);
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
  return () => client.end();
}
