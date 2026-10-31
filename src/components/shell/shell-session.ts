import { sessionTag } from "@/server/auth/principal";

/**
 * Which session cookie a page was rendered under, and the server time of the
 * render (D-118, src/client/session-marks.ts). AppShell hands it to
 * SessionObserver, so every page in the shell marks the session for the other
 * tabs of the browser, also the pages a sign-in returns to (F-113 t.1). Only a
 * digest of the cookie reaches the browser, never the cookie.
 */
export type ShellSession = { tag: string | null; at: number };

export function shellSession(token: string | undefined): ShellSession {
  return { tag: sessionTag(token), at: Date.now() };
}
