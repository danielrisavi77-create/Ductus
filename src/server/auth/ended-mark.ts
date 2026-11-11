import { sessionTag } from "./principal";

/**
 * The name the browser gives its own record that a session ended on it,
 * `ductus-ended-<tag>`, written before the sign-out goes on to the provider
 * (src/client/session-marks.ts, `endSessionsInCookie`).
 */
export const ENDED_MARK_PREFIX = "ductus-ended-";

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
