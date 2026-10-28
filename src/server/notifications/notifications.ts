import type { WithActor } from "@/server/db/with-actor";
import { readJsonMutation } from "@/server/institution/mutation-route";

// Individual metadata only. A future inbox is a separate caller and must not
// treat this as a complete list or infer a count from it. The existing marker
// still supports assignment-version notifications only.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 256;
const NO_STORE = { "cache-control": "no-store" };

type ResultKind = "not_found" | "unauthorized" | "unavailable";
type NotificationEventKind = "assignment_version" | "comment_posted" | "submission_recorded";
export type NotificationItemRead =
  | { kind: "ok"; item: { id: string; eventKind: NotificationEventKind; targetId: string; createdWindow: string; isRead: boolean } }
  | { kind: ResultKind };
export type NotificationMark = { kind: "ok" | ResultKind };

function errorKind(error: unknown): "unauthorized" | "unavailable" {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return code === "ZD401" ? "unauthorized" : "unavailable";
}

function validToken(token: string | undefined): token is string {
  return typeof token === "string" && token.length === 43 && TOKEN.test(token);
}

function validId(id: unknown): id is string {
  return typeof id === "string" && id.length === 36 && UUID.test(id);
}

/** Session identity is bound by withActor. A missing or forbidden item is one answer. */
export async function readNotification(
  sessionToken: string | undefined, notificationId: unknown, withActor: WithActor,
): Promise<NotificationItemRead> {
  if (!validToken(sessionToken)) return { kind: "unauthorized" };
  if (!validId(notificationId)) return { kind: "not_found" };
  try {
    const { rows } = await withActor(sessionToken, (tx) => tx.query<Record<string, unknown>>(
      `SELECT notification_id::text, kind, target_id::text, created_window, is_read
       FROM institution.read_notification($1::uuid)
       UNION ALL
       SELECT notification_id::text, kind, target_id::text, created_window, is_read
       FROM institution.read_comment_notification($1::uuid)
       UNION ALL
       SELECT notification_id::text, kind, target_id::text, created_window, is_read
       FROM institution.read_submission_notification($1::uuid)`, [notificationId],
    ));
    if (!Array.isArray(rows)) return { kind: "unavailable" };
    if (rows.length === 0) return { kind: "not_found" };
    if (rows.length !== 1) return { kind: "unavailable" };
    const row = rows[0];
    const time = row.created_window instanceof Date ? row.created_window.getTime() : NaN;
    if (Object.keys(row).sort().join(",") !== "created_window,is_read,kind,notification_id,target_id"
      || !validId(row.notification_id) || row.notification_id.toLowerCase() !== notificationId.toLowerCase()
      || (row.kind !== "assignment_version" && row.kind !== "comment_posted" && row.kind !== "submission_recorded")
      || !validId(row.target_id)
      || !Number.isFinite(time) || time % 300_000 !== 0 || typeof row.is_read !== "boolean") {
      return { kind: "unavailable" };
    }
    return { kind: "ok", item: {
      id: row.notification_id, eventKind: row.kind, targetId: row.target_id,
      createdWindow: row.created_window instanceof Date ? row.created_window.toISOString() : "", isRead: row.is_read,
    } };
  } catch (error) {
    return { kind: errorKind(error) };
  }
}

/** The RPC checks ownership and current target access in the same transaction. */
export async function markNotificationRead(
  sessionToken: string | undefined, notificationId: unknown, withActor: WithActor,
): Promise<NotificationMark> {
  if (!validToken(sessionToken)) return { kind: "unauthorized" };
  if (!validId(notificationId)) return { kind: "not_found" };
  try {
    const { rows } = await withActor(sessionToken, (tx) => tx.query<{ marked: unknown }>(
      "SELECT institution.mark_notification_read($1::uuid) AS marked", [notificationId],
    ));
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || Object.keys(rows[0]).join(",") !== "marked"
      || typeof rows[0].marked !== "boolean") {
      return { kind: "unavailable" };
    }
    return { kind: rows[0].marked ? "ok" : "not_found" };
  } catch (error) {
    return { kind: errorKind(error) };
  }
}

function reply(status: number, body: { marked: true } | { error: string }): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** POST body carries only the notification id, never a user or institution. */
export async function handleMarkNotificationReadRequest(
  request: Request, deps: { withActor: WithActor; expectedOrigin: string; sessionToken?: string },
): Promise<Response> {
  const input = await readJsonMutation(request, [], {
    ...deps, sessionToken: validToken(deps.sessionToken) ? deps.sessionToken : undefined,
  }, MAX_BODY_BYTES);
  if (!input.ok) return input.response;
  const value = input.value;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 1 || !Object.hasOwn(value, "notificationId")
    || !validId((value as Record<string, unknown>).notificationId)) {
    return reply(422, { error: "invalid_input" });
  }
  const result = await markNotificationRead(input.sessionToken, (value as Record<string, unknown>).notificationId, deps.withActor);
  if (result.kind === "ok") return reply(200, { marked: true });
  const status = { unauthorized: 401, not_found: 404, unavailable: 503 } as const;
  return reply(status[result.kind], { error: result.kind });
}
