import pg from "pg";

import { createWithActor, type WithActor } from "./with-actor";

export type { ActorTransaction, WithActor } from "./with-actor";

let appWithActor: WithActor | undefined;

// APP_DATABASE_URL is the login of the web process: a member of ductus_app,
// provisioned per environment (docs/BACKEND.md 3, rule 2). There is no
// default, so a process without it has no database access at all.
function connect(): WithActor {
  const connectionString = process.env.APP_DATABASE_URL;
  if (!connectionString) {
    throw new Error("APP_DATABASE_URL is not set; database access stays closed");
  }
  const pool = new pg.Pool({ connectionString });
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
