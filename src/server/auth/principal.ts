import { createHash } from "node:crypto";

import type { WithActor } from "@/server/db/with-actor";

/**
 * Who the session cookie belongs to, as far as the browser's local journal is
 * concerned (F-5, plan #376 critical contract 1). The identity comes from the
 * database, through `app.current_actor()`, never from the request: the cookie
 * is only presented, as withActor requires.
 *
 * - `signed-in`: an open, unexpired session. `scope` names the IndexedDB
 *   journal of that person and institution and nothing else.
 * - `signed-out`: no cookie, a malformed one, or a session that is closed or
 *   expired. Nothing is shown as signed in.
 * - `unverified`: a well-formed cookie the database could not be asked about.
 *   The page must not guess either way, so it offers no journal at all.
 */
export type SessionPrincipal =
  | { kind: "signed-in"; scope: string }
  | { kind: "signed-out" }
  | { kind: "unverified" };

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/**
 * Plain-text label the scope digest is derived from; versioned on purpose and
 * different from the local demo label, so no principal's journal is ever the
 * demo journal (src/lib/journal/local-scope.ts).
 */
export const PRINCIPAL_SCOPE_LABEL = "ductus-principal-journal-v1";

/**
 * SHA-256 hex of the label, the institution and the user. The digest names a
 * database; it is not a secret and reveals neither id on its own.
 */
export function principalScope(userId: string, institutionId: string): string {
  return createHash("sha256")
    .update(`${PRINCIPAL_SCOPE_LABEL}\n${institutionId}\n${userId}`, "utf8")
    .digest("hex");
}

/** Plain-text label of the session tag; never the database's token digest. */
export const SESSION_TAG_LABEL = "ductus-session-tag-v1";

/**
 * Which cookie a page was rendered under, for the tabs of one browser (F-5,
 * D-118; src/client/session-marks.ts): a SHA-256 hex of the label and the
 * token, or null without a well-formed cookie. It says nothing about whether
 * the session is open, and it is not the digest the database keeps.
 */
export function sessionTag(token: string | undefined): string | null {
  if (token === undefined || !TOKEN_FORMAT.test(token)) return null;
  return createHash("sha256").update(`${SESSION_TAG_LABEL}\n${token}`, "utf8").digest("hex");
}

export async function sessionPrincipal(
  token: string | undefined,
  withActor: WithActor,
): Promise<SessionPrincipal> {
  if (token === undefined || !TOKEN_FORMAT.test(token)) return { kind: "signed-out" };
  let actor: { user_id: string | null; institution_id: string | null } | undefined;
  try {
    actor = await withActor(token, async (tx) => {
      const { rows } = await tx.query<{ user_id: string | null; institution_id: string | null }>(
        "SELECT user_id, institution_id FROM app.current_actor()",
      );
      return rows[0];
    });
  } catch (error) {
    // Only the error's name: never the token, a statement or a message.
    console.error("session check failed", error instanceof Error ? error.name : "unknown");
    return { kind: "unverified" };
  }
  if (!actor?.user_id || !actor.institution_id) return { kind: "signed-out" };
  return { kind: "signed-in", scope: principalScope(actor.user_id, actor.institution_id) };
}
