import { after } from "next/server";

import { withActor as appWithActor, type WithActor } from "@/server/db";

import { SESSION_COOKIE_NAME } from "./session-token";

/**
 * Session activity (D-200 P2, DAN-296). A protected page render and an
 * accepted state-changing request count as activity and move the session's
 * last_seen_at through identity.touch_current_session(); nothing else does.
 * The database decides whether to write (open, unexpired, idle under two
 * hours, last write at least a minute ago), so a closed or idle session is
 * never revived from here.
 *
 * The touch is its own withActor transaction once the request has its answer,
 * so it never changes that answer and a failure costs only the touch.
 */

// The format withActor and app.current_actor() accept. Anything else is
// anonymous, and there is nothing to touch, so the database is not asked.
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const TOUCH_SQL = "SELECT identity.touch_current_session() AS touched";

/**
 * Records activity of the session behind `token`. Resolves to whether the
 * database moved last_seen_at; it never throws. A missing or malformed token
 * sends no query. A failure is logged by error name only: no token, no
 * message (it can quote the query) and nothing else from the request.
 */
export async function recordActivity(token: string | null | undefined, run: WithActor = appWithActor): Promise<boolean> {
  if (typeof token !== "string" || !TOKEN_FORMAT.test(token)) return false;
  try {
    return await run(token, async (tx) => {
      const { rows } = await tx.query<{ touched: boolean }>(TOUCH_SQL);
      return rows[0]?.touched === true;
    });
  } catch (error) {
    console.error("session activity not recorded:", error instanceof Error ? error.name : "unknown");
    return false;
  }
}

/** Schedules the touch for after the response; the default is Next's after(). */
export type Schedule = (task: () => Promise<unknown>) => void;

const afterResponse: Schedule = (task) => after(task);

/**
 * A protected page render counts as activity. Call it once the page has read
 * the session cookie, before anything that may redirect or throw: after()
 * still runs then, so a page that sends the user elsewhere counts too.
 */
export function pageActivity(token: string | undefined, schedule: Schedule = afterResponse): void {
  if (typeof token !== "string" || !TOKEN_FORMAT.test(token)) return;
  schedule(() => recordActivity(token));
}

interface CookieRequest extends Request {
  cookies: { get(name: string): { value: string } | undefined };
}

/**
 * Wraps a state-changing route handler that goes through
 * checkMutationRequest: an accepted request (2xx) counts as activity, a
 * refused or failed one does not. The touch runs once the handler has its
 * response, which is returned unchanged; it is awaited rather than left to
 * after(), because route handlers are also called outside a Next request
 * (integration tests), where after() throws. The cookie is read before the
 * handler, so a handler that clears it does not change which session counts.
 */
export function counted<R extends CookieRequest, A extends unknown[]>(
  handler: (request: R, ...rest: A) => Promise<Response>,
  record: (token: string) => Promise<boolean> = recordActivity,
): (request: R, ...rest: A) => Promise<Response> {
  return async (request, ...rest) => {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const response = await handler(request, ...rest);
    if (response.status >= 200 && response.status < 300 && token !== undefined && TOKEN_FORMAT.test(token)) {
      await record(token);
    }
    return response;
  };
}
