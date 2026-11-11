import { ENDED_MARK_PREFIX } from "./ended-session-cookie";
import { sessionTag } from "./principal";

/**
 * The browser's record that a session ended on it, `ductus-ended-<tag>`.
 * A page script writes it before the sign-out goes on to the provider
 * (src/client/session-marks.ts, `endSessionsInCookie`), and the logout answer
 * writes it too, for the form without JavaScript (endedMarkCookie).
 */
export { ENDED_MARK_PREFIX };
const ENDED_MARK_MAX_AGE_S = 86_400;

/**
 * The Set-Cookie of the mark for the session the logout just closed, or null
 * without a well-formed cookie. It names only that session's tag, so an
 * answer that lands after a sign-in in another tab leaves the newer cookie
 * alone. Not HttpOnly: the page reads the same mark (session-marks.ts).
 */
export function endedMarkCookie(token: string | undefined): string | null {
  const tag = sessionTag(token);
  return tag === null ? null : `${ENDED_MARK_PREFIX}${tag}=1; Path=/; Max-Age=${ENDED_MARK_MAX_AGE_S}; SameSite=Lax; Secure`;
}

/**
 * Whether this browser recorded that it signed the cookie's session out
 * (#1929). A sign-out no longer clears the session cookie, so the pages that
 * would show a closed session as expired (Z-03) or forward a cookie of the
 * session's shape show the signed-out page instead. Only a choice between two
 * signed-out pages: a page script can write the record, so it never opens or
 * keeps anything open, and the database still decides whether the session lives.
 */
export function endedHere(token: string | undefined, has: (name: string) => boolean): boolean {
  const tag = sessionTag(token);
  return tag !== null && has(`${ENDED_MARK_PREFIX}${tag}`);
}
