import { sessionTag } from "./principal";
import { SESSION_COOKIE_NAME } from "./session-token";

/**
 * The cookies this page's script writes when a sign-out ends a session in
 * this browser (#1444, src/client/session-marks.ts): one `ductus-ended-<tag>`
 * per session, and the older shared `ductus-ended=<tag>.<tag>` list.
 */
export const ENDED_MARK_COOKIE = "ductus-ended";

/** `cookies()` from next/headers and `request.cookies` both answer this. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/**
 * The session cookie a server render or a GET route may act on (DAN-99). A
 * session this browser has ended by a sign-out, answered or not, reads as no
 * cookie at all, so a page shows the signed-out card and no data.
 *
 * Only reads: the session row, the session cookie and the activity record
 * stay as they are (DAN-511b). The session ends at expiry, or when the next
 * sign-in closes the cookie it finds.
 *
 * The mark is the cookie's name, not its value, and names exactly one tag
 * (lowercase hex), so another session's mark never hides this one.
 */
export function liveSessionToken(jar: CookieReader): string | undefined {
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  const tag = sessionTag(token);
  if (tag === null) return token;
  if (jar.get(`${ENDED_MARK_COOKIE}-${tag}`) !== undefined) return undefined;
  const legacy = jar.get(ENDED_MARK_COOKIE)?.value ?? "";
  return legacy.split(".").includes(tag) ? undefined : token;
}
