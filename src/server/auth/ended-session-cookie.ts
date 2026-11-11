// Runs in the middleware (edge runtime): Web Crypto only, no node: imports.
// The names below are checked against the server's own constants in
// ended-session-cookie.test.ts.

/** `__Host-ductus_session` (session-token.ts). */
const SESSION_COOKIE = "__Host-ductus_session";
/** `ductus-ended-<tag>` (ended-mark.ts; src/client/session-marks.ts). */
export const ENDED_MARK_PREFIX = "ductus-ended-";
/** principal.ts SESSION_TAG_LABEL. */
const TAG_LABEL = "ductus-session-tag-v1";
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

async function tagOf(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${TAG_LABEL}\n${token}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The Cookie header of a page request without a session cookie that this
 * browser recorded as signed out (#1929). A sign-out never clears the session
 * cookie, because its answer could land after a sign-in in another tab; it
 * marks the closed session's tag instead. Every page then reads that cookie as
 * no session, also without JavaScript. Only a session that was signed out
 * here is dropped: another tab's newer cookie has another tag and stays.
 * Returns null when nothing changes.
 */
export async function withoutEndedSession(header: string | null): Promise<string | null> {
  if (header === null) return null;
  const parts = header.split(";").map((part) => part.trim()).filter((part) => part !== "");
  const names = new Set(parts.map((part) => part.slice(0, Math.max(part.indexOf("="), 0))));
  const sessions = parts.filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (sessions.length === 0) return null;
  const ended = new Set<string>();
  for (const part of sessions) {
    const token = part.slice(SESSION_COOKIE.length + 1);
    if (TOKEN_FORMAT.test(token) && names.has(`${ENDED_MARK_PREFIX}${await tagOf(token)}`)) ended.add(part);
  }
  if (ended.size === 0) return null;
  return parts.filter((part) => !ended.has(part)).join("; ");
}
