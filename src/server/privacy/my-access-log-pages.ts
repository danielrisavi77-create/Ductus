import { type AccessLogDay, accessLogDaysOf, mergeAccessLogPages } from "@/domain/privacy/access-log-days";
import type { WithActor } from "@/server/db/with-actor";

import { type AccessLogCursor, readMyAccessLog } from "./my-access-log";

/**
 * DAN-294 (S-42, contract on #1836, c.6814737263): "Prikaži starije dane"
 * without client code. The page asks for `?stranica=n` and the server reads
 * the first n pages in turn, each with the cursor the one before gave, and
 * appends each continuation through mergeAccessLogPages: an opening written
 * between two reads never enters the middle and no row is shown twice. Any
 * page that fails fails the whole read, so the student never sees part of a
 * log as if it were all of it. At most ACCESS_LOG_MAX_PAGES pages are read;
 * when the last of them is still full, `truncated` says older openings exist
 * that this page does not reach, and the screen says so.
 */

export const ACCESS_LOG_MAX_PAGES = 20;

/** `?stranica=` as a page count, 1 when absent or not a whole number in range. */
export function pagesParam(raw: string | string[] | undefined): number {
  if (typeof raw !== "string" || !/^[1-9][0-9]?$/.test(raw)) return 1;
  return Math.min(Number(raw), ACCESS_LOG_MAX_PAGES);
}

export type MyAccessLogPages =
  /**
   * `more` is true when an older page exists and another may be asked for;
   * `truncated` when an older page exists beyond the last page allowed.
   */
  | { kind: "ok"; days: AccessLogDay[]; more: boolean; truncated: boolean }
  | { kind: "unauthorized" | "not_found" | "unavailable" };

export async function readMyAccessLogPages(
  sessionToken: string | undefined,
  withActor: WithActor,
  documentId: string,
  pages: number,
): Promise<MyAccessLogPages> {
  let rows: Record<string, unknown>[] = [];
  let cursor: AccessLogCursor | undefined;
  let more = false;
  for (let page = 0; page < pages; page += 1) {
    const read = await readMyAccessLog(sessionToken, withActor, documentId, cursor);
    if (read.kind !== "ok") return { kind: read.kind };
    rows = page === 0 ? read.rows : mergeAccessLogPages(rows, read.rows);
    if (read.next === null) {
      more = false;
      break;
    }
    cursor = read.next;
    more = true;
  }
  const days = accessLogDaysOf(rows);
  if (days === null) return { kind: "unavailable" };
  const capped = pages >= ACCESS_LOG_MAX_PAGES;
  return { kind: "ok", days, more: more && !capped, truncated: more && capped };
}
