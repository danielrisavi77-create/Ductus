import type { Pool } from "pg";

/** What a verified logout token names (DAN-474). `issuer` is the account key's spelling. */
export interface BackchannelLogoutInput {
  issuer: string;
  subject: string | null;
  sid: string | null;
  jti: string;
}

export type BackchannelLogoutResult = { ok: true; closed: number } | { ok: false; reason: "replayed" | "invalid" };

/** Closes the sessions a verified logout token names; `replayed` when its `jti` was seen. */
export type BackchannelLogout = (input: BackchannelLogoutInput) => Promise<BackchannelLogoutResult>;

/**
 * Closing the sessions a verified logout token names (DAN-474). Only the
 * back-channel route calls this, over the ductus_auth login, as the login
 * callback opens sessions: the web process login (ductus_app) never holds
 * identity.backchannel_logout.
 *
 * ZD409 is a `jti` already recorded (a replay), ZD422 input the database
 * refuses; both end as 400 at the route. Any other error is thrown (503).
 */
const BACKCHANNEL_LOGOUT_SQL = `
SELECT CASE WHEN (SELECT NOT r.rolsuper AND NOT r.rolbypassrls
                         AND pg_catalog.pg_has_role(r.oid, 'ductus_auth', 'USAGE')
                         AND NOT pg_catalog.pg_has_role(r.oid, 'ductus_app', 'MEMBER')
                    FROM pg_catalog.pg_roles r
                   WHERE r.rolname = session_user AND session_user = current_user)
            THEN identity.backchannel_logout($1, $2, $3, $4)
       END AS closed`;

export function createBackchannelLogout(pool: Pick<Pool, "query">): BackchannelLogout {
  return async function backchannelLogout(input) {
    try {
      const { rows } = await pool.query<{ closed: number | null }>(BACKCHANNEL_LOGOUT_SQL, [
        input.issuer,
        input.subject,
        input.sid,
        input.jti,
      ]);
      const closed = rows[0]?.closed;
      if (typeof closed !== "number") {
        throw new Error("backchannelLogout: the database connection is not a ductus_auth login");
      }
      return { ok: true, closed };
    } catch (error) {
      // Only the code is read; nothing from the token reaches a log.
      const code = (error as { code?: unknown } | null)?.code;
      if (code === "ZD409") return { ok: false, reason: "replayed" };
      if (code === "ZD422") return { ok: false, reason: "invalid" };
      throw error;
    }
  };
}
