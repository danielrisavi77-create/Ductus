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

type ActorRow = { user_id: string | null; institution_id: string | null; institution_slug?: string | null };

/** One statement, one transaction; null on an error the caller turns into `unverified`. */
async function readActor(token: string, withActor: WithActor, statement: string): Promise<ActorRow | undefined | null> {
  try {
    return await withActor(token, async (tx) => (await tx.query<ActorRow>(statement)).rows[0]);
  } catch (error) {
    // Only the error's name: never the token, a statement or a message.
    console.error("session check failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

export async function sessionPrincipal(
  token: string | undefined,
  withActor: WithActor,
): Promise<SessionPrincipal> {
  if (token === undefined || !TOKEN_FORMAT.test(token)) return { kind: "signed-out" };
  const actor = await readActor(token, withActor, "SELECT user_id, institution_id FROM app.current_actor()");
  if (actor === null) return { kind: "unverified" };
  if (!actor?.user_id || !actor.institution_id) return { kind: "signed-out" };
  return { kind: "signed-in", scope: principalScope(actor.user_id, actor.institution_id) };
}

/** As `SessionPrincipal`, and a signed-in one also names the slug of its institution. */
export type SessionPrincipalWithInstitution =
  | { kind: "signed-in"; scope: string; institution: string | null }
  | { kind: "signed-out" }
  | { kind: "unverified" };

/**
 * `sessionPrincipal` plus the slug of the session's institution, whose record
 * gives the citation style (M2.12-P02, plan #1689 C1 to C7). Person and slug
 * come from the same statement and transaction, so a session closed in
 * between yields neither, and an institution never comes from the request.
 */
export async function sessionPrincipalWithInstitution(
  token: string | undefined,
  withActor: WithActor,
): Promise<SessionPrincipalWithInstitution> {
  if (token === undefined || !TOKEN_FORMAT.test(token)) return { kind: "signed-out" };
  const actor = await readActor(
    token, withActor,
    "SELECT user_id, institution_id, app.current_institution_slug() AS institution_slug FROM app.current_actor()",
  );
  if (actor === null) return { kind: "unverified" };
  if (!actor?.user_id || !actor.institution_id) return { kind: "signed-out" };
  const slug = actor.institution_slug;
  return {
    kind: "signed-in",
    scope: principalScope(actor.user_id, actor.institution_id),
    institution: typeof slug === "string" ? slug : null,
  };
}
