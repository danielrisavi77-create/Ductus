// D-91 (3), DAN-71: the connection on which scripts/db/migrate-locked.mjs
// holds the migration advisory lock. It lives here because only src/server/db
// may hold the database driver (eslint.config.mjs); the application never
// imports it. Node runs it with type stripping, as plain-label-check.ts.
import pg from "pg";

/** Settles like `promise`, or rejects with the abort reason as soon as `signal` aborts. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener("abort", onAbort));
}

/**
 * Opens the lock connection, retrying while the server starts (as dbmate
 * --wait does). The `role` query parameter is dbmate's, not the driver's, and
 * is dropped: the advisory lock needs no role. Each attempt ends after
 * `connectTimeoutMs`. An aborted `signal` stops the retries and ends a pending
 * attempt at once, even one whose server never answers; a connection that
 * opens after the abort is closed, not returned.
 */
export async function connectLockClient(
  url: string,
  {
    attempts = 60,
    delayMs = 1000,
    connectTimeoutMs = 10_000,
    signal,
  }: { attempts?: number; delayMs?: number; connectTimeoutMs?: number; signal?: AbortSignal } = {},
): Promise<pg.Client> {
  const lockUrl = new URL(url);
  lockUrl.searchParams.delete("role");
  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    const client = new pg.Client({
      connectionString: lockUrl.href,
      keepAlive: true,
      connectionTimeoutMillis: connectTimeoutMs,
      application_name: "ductus-migrate-lock",
    });
    const connecting = client.connect();
    try {
      await unlessAborted(connecting, signal);
    } catch (error) {
      connecting.catch(() => {});
      // Not awaited: after an abort the driver may not settle connect() or
      // end(); connectionTimeoutMillis then closes the socket.
      client.end().catch(() => {});
      if (signal?.aborted) signal.throwIfAborted();
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    // Cancelled while the connection was opening: the caller gets no client.
    if (signal?.aborted) {
      await client.end().catch(() => {});
      signal.throwIfAborted();
    }
    return client;
  }
}
