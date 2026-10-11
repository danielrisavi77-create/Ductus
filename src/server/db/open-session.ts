import type { Pool } from "pg";

/**
 * Opening a session at login (B-6, docs/BACKEND.md 4.3). Only the login
 * callback calls this, over its own login in ductus_auth: the web process
 * login (ductus_app) never holds identity.open_session, and this login never
 * reaches withActor, which refuses anything but a ductus_app member.
 */
export interface OpenSessionInput {
  issuer: string;
  subject: string;
  uniqueId: string;
  homeOrg: string;
  tokenHash: Buffer;
}

/**
 * `refused` covers ZD403 (identity does not match the account), ZD422
 * (invalid input) and ZD503 (no institution for this home organisation):
 * the route shows them as one neutral message, so nobody learns which.
 * `conflict` is ZD409, a token hash already in use.
 */
export type OpenSessionResult =
  | { ok: true; expires: Date }
  | { ok: false; reason: "refused" | "conflict" };

export type OpenSession = (input: OpenSessionInput) => Promise<OpenSessionResult>;

const REFUSED = new Set(["ZD403", "ZD422", "ZD503"]);

// The role check runs in the same statement, before the function: a plain
// login (no SET ROLE) that is a member of ductus_auth, never of ductus_app,
// without SUPERUSER or BYPASSRLS. The CASE stops the call otherwise.
const OPEN_SESSION_SQL = `
SELECT CASE WHEN (SELECT NOT r.rolsuper AND NOT r.rolbypassrls
                         AND pg_catalog.pg_has_role(r.oid, 'ductus_auth', 'USAGE')
                         AND NOT pg_catalog.pg_has_role(r.oid, 'ductus_app', 'MEMBER')
                    FROM pg_catalog.pg_roles r
                   WHERE r.rolname = session_user AND session_user = current_user)
            THEN identity.open_session($1, $2, $3, $4, $5)
       END AS expires`;

export function createOpenSession(pool: Pick<Pool, "query">): OpenSession {
  return async function openSession(input) {
    try {
      const { rows } = await pool.query<{ expires: Date | null }>(OPEN_SESSION_SQL, [
        input.issuer,
        input.subject,
        input.uniqueId,
        input.homeOrg,
        input.tokenHash,
      ]);
      const expires = rows[0]?.expires;
      if (!(expires instanceof Date)) {
        throw new Error("openSession: the database connection is not a ductus_auth login");
      }
      return { ok: true, expires };
    } catch (error) {
      // Only the code is read: the message of these errors carries no input,
      // but nothing from the provider reaches a log either way.
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && REFUSED.has(code)) return { ok: false, reason: "refused" };
      if (code === "ZD409") return { ok: false, reason: "conflict" };
      throw error;
    }
  };
}
