import { cookies } from "next/headers";

import { sessionTag } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";

import SessionObserver from "./SessionObserver";

/**
 * Records, for the tabs of this browser, which session cookie this request
 * was rendered under (D-118, F-113 t.1). AppHeader renders it, so every plain
 * screen marks the session, including the ones a sign-in returns to: a
 * sign-in there ends the earlier session's tabs. Only a digest of the cookie
 * reaches the browser, never the cookie.
 */
export default async function SessionMark() {
  const at = Date.now();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return <SessionObserver tag={sessionTag(token)} at={at} />;
}
