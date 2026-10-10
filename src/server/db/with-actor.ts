import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import type { Pool, QueryConfig, QueryResultRow } from "pg";

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

// The configuration lock: the connection must be a plain login that is a
// member of ductus_app. A superuser, a BYPASSRLS role or a session that
// switched role (and could switch back) is refused. pg_stat_activity keeps
// the role that authenticated, which SET SESSION AUTHORIZATION does not
// change: a superuser connection that took on an app login's name would
// otherwise pass and could RESET back to superuser inside fn.
const APP_ROLE_SQL = `
(SELECT NOT r.rolsuper AND NOT r.rolbypassrls
        AND pg_catalog.pg_has_role(r.oid, 'ductus_app', 'USAGE')
   FROM pg_catalog.pg_roles r
   JOIN pg_catalog.pg_stat_activity a ON a.usesysid = r.oid
  WHERE a.pid = pg_catalog.pg_backend_pid()
    AND r.rolname = session_user AND session_user = current_user)`;

// One statement sets the token, marks the transaction and checks the
// connection. `true` makes both settings transaction-local (SET LOCAL); a
// session-level value would follow the pooled connection to the next request.
// The token is set on every call, also for anonymous, so a value left on the
// connection by anything else is overridden for the whole transaction.
const ENTER_ACTOR_SQL = `
SELECT pg_catalog.set_config('app.session_token', $1, true) IS NOT NULL
       AND pg_catalog.set_config('app.with_actor_tx', $2, true) = $2 AS token_set,
       ${APP_ROLE_SQL} AS app_role`;

// Before COMMIT: the marker is gone if the transaction that withActor began
// has ended, the token differs if fn replaced it, and the lock is checked
// again in case fn changed role.
const EXIT_ACTOR_SQL = `
SELECT pg_catalog.current_setting('app.with_actor_tx', true) IS NOT DISTINCT FROM $1
       AND pg_catalog.current_setting('app.session_token', true) IS NOT DISTINCT FROM $2 AS same_tx,
       ${APP_ROLE_SQL} AS app_role`;

// fn may read and change data, nothing else. Transaction control (BEGIN,
// COMMIT, SAVEPOINT ...) and session state (SET, RESET, DISCARD, PREPARE,
// LISTEN ...) are refused before they reach the database, because either can
// outlive the transaction on a pooled connection. One statement per call is
// enforced by the extended protocol, so only the first keyword matters.
const ALLOWED_STATEMENTS = new Set(["SELECT", "WITH", "INSERT", "UPDATE", "DELETE", "MERGE", "VALUES", "TABLE", "CALL"]);

/** The first keyword of `text` after whitespace, comments and parentheses, upper-cased; "" if there is none. */
export function leadingKeyword(text: string): string {
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (" \t\n\r\f\v(".includes(char)) {
      at += 1;
    } else if (text.startsWith("--", at)) {
      // A line comment ends at \n or \r, as in the PostgreSQL scanner.
      const end = text.slice(at).search(/[\n\r]/);
      if (end === -1) return "";
      at += end + 1;
    } else if (text.startsWith("/*", at)) {
      // PostgreSQL block comments nest.
      let depth = 0;
      do {
        if (text.startsWith("/*", at)) {
          depth += 1;
          at += 2;
        } else if (text.startsWith("*/", at)) {
          depth -= 1;
          at += 2;
        } else if (at >= text.length) {
          return "";
        } else {
          at += 1;
        }
      } while (depth > 0);
    } else {
      return /^[A-Za-z]+/.exec(text.slice(at))?.[0].toUpperCase() ?? "";
    }
  }
  return "";
}

// Set while fn runs. A withActor inside fn would take a second connection
// with its own transaction: it would commit apart from the outer one and can
// wait forever for a connection that the outer call holds.
const insideActor = new AsyncLocalStorage<true>();

export function createWithActor(pool: Pick<Pool, "connect">): WithActor {
  return async function withActor(token, fn) {
    if (insideActor.getStore()) throw new Error("withActor: nested call inside a withActor transaction");
    const sessionToken = typeof token === "string" && TOKEN_FORMAT.test(token) ? token : "";
    const marker = randomUUID();
    const client = await pool.connect();
    let open = false;
    // Set when the connection may carry state from this call: it is closed
    // instead of going back to the pool.
    let connectionError: Error | undefined;
    // A connection that drops while it is checked out emits "error" with no
    // query to reject; unhandled, that ends the process. The query in flight
    // or the next one fails on its own, and the connection is not pooled.
    const onConnectionError = (error: Error) => {
      connectionError ??= error;
    };
    client.on("error", onConnectionError);

    const tx: ActorTransaction = {
      async query(text, values) {
        // A handle kept past its transaction would otherwise run on a
        // connection that by then serves another actor.
        if (!open) throw new Error("withActor: the transaction has ended");
        const keyword = leadingKeyword(String(text));
        if (!ALLOWED_STATEMENTS.has(keyword)) {
          throw new Error(`withActor: ${keyword || "this"} statement is not allowed in a withActor transaction`);
        }
        // queryMode is in pg but not in its type definitions.
        const config: QueryConfig & { queryMode: "extended" } = {
          text,
          values: values === undefined ? undefined : [...values],
          queryMode: "extended",
        };
        const result = await client.query(config);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
    };

    try {
      await client.query("BEGIN");
      const entered = await client.query(ENTER_ACTOR_SQL, [sessionToken, marker]);
      if (entered.rows[0]?.token_set !== true || entered.rows[0]?.app_role !== true) {
        connectionError = new Error("withActor: the database connection is not a ductus_app login");
        throw connectionError;
      }
      open = true;
      const value = await insideActor.run(true, () => fn(tx));
      open = false;
      const exited = await client.query(EXIT_ACTOR_SQL, [marker, sessionToken]).catch((error: unknown) => {
        // An error that fn swallowed has aborted the transaction.
        if ((error as { code?: unknown } | null)?.code === "25P02") {
          throw new Error("withActor: the transaction was rolled back", { cause: error });
        }
        throw error;
      });
      if (exited.rows[0]?.same_tx !== true || exited.rows[0]?.app_role !== true) {
        connectionError = new Error("withActor: the transaction, the token or the role changed inside fn");
        throw connectionError;
      }
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
        connectionError ??= rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
      }
      throw error;
    } finally {
      client.removeListener("error", onConnectionError);
      client.release(connectionError);
    }
  };
}
