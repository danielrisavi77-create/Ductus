import { type AccessLogDay, accessLogDaysOf, accessLogEntryOf, zonedInstantOf } from "@/domain/privacy/access-log-days";
import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-294 (M10.4, S-42; contract on #1836, c.6814737263): the student's own
 * access log of one work, read through `app.read_my_access_log` under
 * withActor. One statement, STABLE, nothing written: an opening recorded
 * after the read shows on the next read, never inside this one. Who asks
 * comes only from the session token; the database decides whose work it is
 * (ZD403 for another person's, an unknown or a malformed work alike, so all
 * three read the same not_found). Nothing is counted or timed (PRODUCT §5
 * rule 17, D-274 MQ10). Only the SQLSTATE is logged, never the error text.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const WINDOW_MS = 5 * 60_000;
const SQL = "SELECT * FROM app.read_my_access_log($1, $2, $3, $4)";

/** Openings per page; the RPC ends a page on a whole window, so a page can hold a few more. */
export const ACCESS_LOG_PAGE = 50;

/** Where the next page starts: the oldest row shown, both halves as the RPC takes them. */
export interface AccessLogCursor {
  beforeAt: string;
  beforeId: string;
}

type Row = Record<string, unknown>;

export type MyAccessLogRead =
  /** `rows` as read, for appending a continuation; `next` null when the page was not full. */
  | { kind: "ok"; rows: Row[]; days: AccessLogDay[]; next: AccessLogCursor | null }
  | { kind: "unauthorized" | "not_found" | "unavailable" };

/** A document id as `evidence.document` allows it: 1 to 256 characters, trimmed, no control characters. */
function isDocumentId(value: string): boolean {
  return value.length >= 1 && value.length <= 256 && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/** The cursor as an ISO instant on the five-minute grid and a lower-case uuid, or null. */
export function cursorOf(cursor: AccessLogCursor): [string, string] | null {
  const ms = zonedInstantOf(cursor.beforeAt);
  if (!Number.isFinite(ms) || ms % WINDOW_MS !== 0 || !UUID.test(cursor.beforeId)) return null;
  return [new Date(ms).toISOString(), cursor.beforeId];
}

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

function unavailable(reason: string): MyAccessLogRead {
  console.error("my access log read failed", reason);
  return { kind: "unavailable" };
}

/** One page of the actor's own access log of `documentId`, newest first, as Zagreb days. */
export async function readMyAccessLog(
  sessionToken: string | undefined,
  withActor: WithActor,
  documentId: string,
  cursor?: AccessLogCursor,
): Promise<MyAccessLogRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  if (!isDocumentId(documentId)) return { kind: "not_found" };
  const before = cursor === undefined ? [null, null] : cursorOf(cursor);
  if (before === null) return { kind: "unavailable" };
  let rows: Row[];
  try {
    rows = await withActor(sessionToken, async (tx) => (await tx.query<Row>(SQL, [documentId, ACCESS_LOG_PAGE, ...before])).rows);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ZD401") return { kind: "unauthorized" };
    if (code === "ZD403") return { kind: "not_found" };
    return unavailable(code !== undefined && SQLSTATE.test(code) ? code : "unknown");
  }
  const days = accessLogDaysOf(rows);
  if (days === null) return unavailable("row_malformed");
  let next: AccessLogCursor | null = null;
  if (rows.length >= ACCESS_LOG_PAGE) {
    // The oldest of the page, by the order the read returns (opened_at, then id, descending).
    const oldest = rows.map((r) => accessLogEntryOf(r)!).reduce((a, b) => (b.at < a.at || (b.at === a.at && b.id < a.id) ? b : a));
    next = { beforeAt: new Date(oldest.at).toISOString(), beforeId: oldest.id };
  }
  return { kind: "ok", rows, days, next };
}
