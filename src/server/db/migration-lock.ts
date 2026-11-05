// D-91 (3), DAN-71: the connection on which scripts/db/migrate-locked.mjs
// holds the migration advisory lock. It lives here because only src/server/db
// may hold the database driver (eslint.config.mjs); the application never
// imports it. Node runs it with type stripping, as plain-label-check.ts.
import pg from "pg";

/**
 * Opens the lock connection, retrying while the server starts (as dbmate
 * --wait does). The `role` query parameter is dbmate's, not the driver's, and
 * is dropped: the advisory lock needs no role. An aborted `signal` stops the
 * retries.
 */
export async function connectLockClient(
  url: string,
  { attempts = 60, delayMs = 1000, signal }: { attempts?: number; delayMs?: number; signal?: AbortSignal } = {},
): Promise<pg.Client> {
  const lockUrl = new URL(url);
  lockUrl.searchParams.delete("role");
  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    const client = new pg.Client({ connectionString: lockUrl.href, keepAlive: true, application_name: "ductus-migrate-lock" });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= attempts || signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
