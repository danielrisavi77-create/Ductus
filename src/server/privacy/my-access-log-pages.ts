import { type AccessLogDay, accessLogDaysOf, accessLogEntryOf } from "@/domain/privacy/access-log-days";
import type { WithActor } from "@/server/db/with-actor";

import { type AccessLogCursor, cursorOf, readMyAccessLog } from "./my-access-log";

/**
 * DAN-294 (S-42; review FAIL c.6819070024, contract on #1836 c.6819193865):
 * "Prikaži starije dane" without client code and without a last page. The
 * address carries the cursor of the oldest row shown (`?prije=<opened_at>&
 * zapis=<id>`) and each request makes exactly one read from it, so every
 * opening is reachable by following the links (PRODUCT §5 rule 17).
 *
 * The cursor is the student's input: it passes the reader's own check
 * (calendar, microseconds, five-minute grid, a lower-case uuid) and may not
 * lie in the future; anything else reads the first page, never a query with
 * that cursor. The read takes only intervals strictly older than the cursor,
 * and an opening is written only into the current interval, so one written
 * between two requests shows on a fresh first page, never inside a
 * continuation; a row not older than the cursor is left out all the same.
 */

/** The query of the page as Next.js hands it; any other parameter, `stranica` too, is ignored. */
export interface AccessLogQuery {
  prije?: string | string[];
  zapis?: string | string[];
}

export type MyAccessLogPage =
  /** `next` is the cursor of an older page, null when there is none; `continued` when read from a cursor. */
  | { kind: "ok"; days: AccessLogDay[]; next: AccessLogCursor | null; continued: boolean }
  | { kind: "unauthorized" | "not_found" | "unavailable" };

/** PostgreSQL has no year zero: an instant before the first of year one is not a cursor. */
const FIRST_INSTANT = Date.parse("0001-01-01T00:00:00Z");

/** The cursor of the address, or null for the first page. */
function cursorParam(query: AccessLogQuery, now: number): AccessLogCursor | null {
  const { prije, zapis } = query;
  if (typeof prije !== "string" || typeof zapis !== "string") return null;
  const checked = cursorOf({ beforeAt: prije, beforeId: zapis });
  if (checked === null) return null;
  const at = Date.parse(checked[0]);
  if (at > now || at < FIRST_INSTANT) return null;
  return { beforeAt: checked[0], beforeId: checked[1] };
}

/** The address of the next older page. */
export function olderHref(here: string, next: AccessLogCursor): string {
  return `${here}?prije=${encodeURIComponent(next.beforeAt)}&zapis=${encodeURIComponent(next.beforeId)}`;
}

export async function readMyAccessLogPage(
  sessionToken: string | undefined,
  withActor: WithActor,
  documentId: string,
  query: AccessLogQuery,
  now: number = Date.now(),
): Promise<MyAccessLogPage> {
  const cursor = cursorParam(query, now);
  const read = await readMyAccessLog(sessionToken, withActor, documentId, cursor ?? undefined);
  if (read.kind !== "ok") return { kind: read.kind };
  if (cursor === null) return { kind: "ok", days: read.days, next: read.next, continued: false };
  const edge = Date.parse(cursor.beforeAt);
  const older = read.rows.filter((r) => (accessLogEntryOf(r)?.at ?? Number.NEGATIVE_INFINITY) < edge);
  const days = accessLogDaysOf(older);
  if (days === null) return { kind: "unavailable" };
  return { kind: "ok", days, next: read.next, continued: true };
}
