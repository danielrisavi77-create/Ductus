import pg from "pg";

import { createWithActor, type WithActor } from "./with-actor";

export type { ActorTransaction, WithActor } from "./with-actor";

let appWithActor: WithActor | undefined;

// Limits of the web process pool. Every wait has an end, so a stuck request
// fails instead of holding a connection or a caller for good.

/**
 * Connections of one web process. Stated instead of left to the driver
 * default: the database has a fixed number of connections, shared with the
 * worker and the migrator, and a request holds one only for its transaction.
 */
export const APP_POOL_MAX = 10;

/**
 * Longest wait for a connection, from the pool or for a new one. The driver
 * default is to wait forever, which turns an exhausted pool, or a withActor
 * nested inside another, into a request that never answers. Five seconds
 * rides out a burst and still fails well before a browser gives up.
 */
export const APP_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Longest single statement, enforced by the server. Requests run short
 * statements; one that takes this long is a lock wait or a runaway query and
 * must not keep its connection. Long work belongs to the worker.
 */
export const APP_STATEMENT_TIMEOUT_MS = 15_000;

/**
 * Longest pause between statements inside a transaction, enforced by the
 * server, which then closes the connection. It bounds how long a stalled
 * request can keep locks and a pool slot. It is longer than the connection
 * timeout, so a nested withActor fails on its own wait first, with the
 * clearer error.
 */
export const APP_IDLE_IN_TRANSACTION_TIMEOUT_MS = 10_000;

/** The pool settings without the pool: tests apply them to a pool of their own. */
export function appPoolConfig(connectionString: string): pg.PoolConfig {
  return {
    connectionString,
    max: APP_POOL_MAX,
    connectionTimeoutMillis: APP_CONNECTION_TIMEOUT_MS,
    // Startup parameters of the connection, not SET statements.
    statement_timeout: APP_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: APP_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  };
}

// APP_DATABASE_URL is the login of the web process: a member of ductus_app,
// provisioned per environment (docs/BACKEND.md 3, rule 2). There is no
// default, so a process without it has no database access at all.
function connect(): WithActor {
  const connectionString = process.env.APP_DATABASE_URL;
  if (!connectionString) {
    throw new Error("APP_DATABASE_URL is not set; database access stays closed");
  }
  const pool = new pg.Pool(appPoolConfig(connectionString));
  // An idle connection that drops must not take the process down. Only the
  // error code is logged: never a statement, a parameter or a token.
  pool.on("error", (error: Error & { code?: string }) => {
    console.error("database pool: idle connection failed", error.code ?? error.name);
  });
  return createWithActor(pool);
}

/**
 * The single way to the database for application code (docs/BACKEND.md 4.3).
 * The pool is not exported and ESLint keeps the driver inside this directory.
 */
export const withActor: WithActor = async (token, fn) => {
  appWithActor ??= connect();
  return appWithActor(token, fn);
};
