import type { Pool, QueryResultRow } from "pg";

/**
 * A query handle that lives for one withActor transaction. It is the only
 * thing application code gets: no pool, no client, no way to keep a
 * connection.
 */
export interface ActorTransaction {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number }>;
}

/**
 * Runs `fn` in one transaction in which `app.current_actor()` answers for the
 * session behind `token` (docs/BACKEND.md 4.3). `token` is the raw value of
 * the session cookie, or null when there is none. The identity is never a
 * parameter: a caller cannot name a user, only present a token.
 */
export type WithActor = <T>(
  token: string | null | undefined,
  fn: (tx: ActorTransaction) => Promise<T>,
) => Promise<T>;

// Same format as app.current_actor(): 32 random bytes in base64url. Anything
// else is anonymous and is not sent to the database at all, so a malformed
// cookie can neither raise an error that echoes it nor reach a log.
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

// One statement sets the token and checks the connection. `true` makes the
// setting transaction-local (SET LOCAL); a session-level value would follow
// the pooled connection to the next request. The token is set on every call,
// also for anonymous, so a value left on the connection by anything else is
// overridden for the whole transaction.
//
// The role check is the configuration lock: the connection must be a plain
// login that is a member of ductus_app. A superuser, a BYPASSRLS role or a
// session that only switched role (and could switch back) is refused before
// `fn` runs, instead of silently reading around RLS.
const ENTER_ACTOR_SQL = `
SELECT pg_catalog.set_config('app.session_token', $1, true) IS NOT NULL AS token_set,
       (SELECT NOT r.rolsuper AND NOT r.rolbypassrls
               AND pg_catalog.pg_has_role(r.oid, 'ductus_app', 'USAGE')
          FROM pg_catalog.pg_roles r
         WHERE r.rolname = session_user AND session_user = current_user) AS app_role`;

export function createWithActor(pool: Pick<Pool, "connect">): WithActor {
  return async function withActor(token, fn) {
    const sessionToken = typeof token === "string" && TOKEN_FORMAT.test(token) ? token : "";
    const client = await pool.connect();
    let open = false;
    let connectionError: Error | undefined;

    const tx: ActorTransaction = {
      async query(text, values) {
        // A handle kept past its transaction would otherwise run on a
        // connection that by then serves another actor.
        if (!open) throw new Error("withActor: the transaction has ended");
        const result = await client.query(text, values === undefined ? undefined : [...values]);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
    };

    try {
      await client.query("BEGIN");
      const entered = await client.query(ENTER_ACTOR_SQL, [sessionToken]);
      if (entered.rows[0]?.token_set !== true || entered.rows[0]?.app_role !== true) {
        throw new Error("withActor: the database connection is not a ductus_app login");
      }
      open = true;
      const value = await fn(tx);
      open = false;
      // COMMIT of a transaction that a swallowed error has aborted succeeds
      // and answers ROLLBACK. That must not look like a saved change.
      const committed = await client.query("COMMIT");
      if (committed.command !== "COMMIT") {
        throw new Error("withActor: the transaction was rolled back");
      }
      return value;
    } catch (error) {
      open = false;
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        // The connection state is unknown: it must not go back to the pool.
        connectionError = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
      }
      throw error;
    } finally {
      client.release(connectionError);
    }
  };
}
