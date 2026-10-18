import { isCommentBody, isDocumentId, isTextAnchorInput } from "@/domain/collaboration";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

export const MAX_COMMENT_BODY_BYTES = 16 * 1024;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const ROLES = new Set(["teacher", "student"]);
const STATES = new Set(["open", "answered", "resolved"]);

export type CommentAction = "create" | "reply" | "resolve" | "reopen" | "list";

export interface CommentDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

export interface CommentView {
  threadId: string;
  commentId: string;
  position: number;
  authorRole: string;
  isOwn: boolean;
  body: string;
  anchor: unknown;
  state: string;
  createdWindow: string;
}

interface Spec {
  keys: string[];
  valid(input: Record<string, unknown>): boolean;
  sql: string;
  params(input: Record<string, unknown>): unknown[];
}

const isThreadId = (value: unknown) => typeof value === "string" && UUID.test(value);

// Identity, role, institution and author are NEVER JSON inputs: the RPCs
// take them from the session inside withActor (docs/BACKEND.md 4.11).
const SPECS: Record<CommentAction, Spec> = {
  create: {
    keys: ["anchor", "body", "documentId"],
    valid: (i) => isDocumentId(i.documentId) && isCommentBody(i.body) && isTextAnchorInput(i.anchor),
    sql: "SELECT collaboration.create_comment($1, $2, $3::jsonb) AS id",
    params: (i) => [i.documentId, i.body, JSON.stringify(i.anchor)],
  },
  reply: {
    keys: ["body", "threadId"],
    valid: (i) => isThreadId(i.threadId) && isCommentBody(i.body),
    sql: "SELECT collaboration.reply_comment($1::uuid, $2) AS id",
    params: (i) => [i.threadId, i.body],
  },
  resolve: {
    keys: ["threadId"],
    valid: (i) => isThreadId(i.threadId),
    sql: "SELECT collaboration.resolve_thread($1::uuid)",
    params: (i) => [i.threadId],
  },
  reopen: {
    keys: ["threadId"],
    valid: (i) => isThreadId(i.threadId),
    sql: "SELECT collaboration.reopen_thread($1::uuid)",
    params: (i) => [i.threadId],
  },
  list: {
    keys: ["documentId"],
    valid: (i) => isDocumentId(i.documentId),
    sql: "SELECT thread_id, comment_id, comment_position, author_role, is_own, body, anchor, state, created_window"
      + " FROM collaboration.list_comments($1)",
    params: (i) => [i.documentId],
  },
};

function respond(status: number, payload?: Record<string, unknown>): Response {
  const headers = { "cache-control": "no-store" };
  if (status === 204) return new Response(null, { status, headers });
  return Response.json(payload ?? { error: "unavailable" }, { status, headers });
}

function strictInput(value: unknown, spec: Spec): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length !== spec.keys.length || keys.some((key, i) => key !== spec.keys[i])) return null;
  return spec.valid(obj) ? obj : null;
}

function commentView(row: Record<string, unknown>): CommentView | null {
  const created = row.created_window instanceof Date ? row.created_window : new Date(String(row.created_window));
  const anchor = row.anchor;
  if (!isThreadId(row.thread_id) || !isThreadId(row.comment_id) || !Number.isSafeInteger(row.comment_position)
    || !ROLES.has(String(row.author_role)) || typeof row.is_own !== "boolean" || typeof row.body !== "string"
    || !STATES.has(String(row.state)) || Number.isNaN(created.getTime())
    || (anchor !== null && (typeof anchor !== "object" || Array.isArray(anchor)))) {
    return null;
  }
  return {
    threadId: row.thread_id as string,
    commentId: row.comment_id as string,
    position: row.comment_position as number,
    authorRole: row.author_role as string,
    isOwn: row.is_own,
    body: row.body,
    anchor,
    state: row.state as string,
    createdWindow: created.toISOString(),
  };
}

function success(action: CommentAction, rows: Record<string, unknown>[]): Response {
  if (action === "resolve" || action === "reopen") return respond(204);
  if (action === "list") {
    const comments = rows.map(commentView);
    if (comments.some((c) => c === null)) return respond(503);
    return respond(200, { comments });
  }
  const id = rows[0]?.id;
  return typeof id === "string" && UUID.test(id) ? respond(200, { id }) : respond(503);
}

// B-10 HTTP boundary. The SECURITY DEFINER RPCs decide who may read or
// write; this refuses malformed requests before the database. Logs carry
// the action and an error code only, never body, anchor or ids (attack 11).
export async function handleCommentRequest(
  action: CommentAction,
  request: Request,
  deps: CommentDeps,
): Promise<Response> {
  const spec = SPECS[action];
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    return respond(503);
  }
  if (!allowed.ok) return respond(allowed.status, { error: allowed.reason });
  if (!deps.sessionToken || !TOKEN.test(deps.sessionToken)) return respond(401, { error: "unauthorized" });
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return respond(415, { error: "unsupported_media_type" });
  }

  const raw = await readBodyWithLimit(request, MAX_COMMENT_BODY_BYTES);
  if (!raw.ok) return respond(raw.status, { error: raw.reason });

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes));
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  const input = strictInput(value, spec);
  if (!input) return respond(422, { error: "invalid_input" });

  try {
    const result = await deps.withActor(deps.sessionToken, async (tx) => tx.query(spec.sql, spec.params(input)));
    return success(action, result.rows);
  } catch (error) {
    // PostgreSQL raises documented ZD codes; never return its message/SQL/params.
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ZD401") return respond(401, { error: "unauthorized" });
    if (code === "ZD403") return respond(403, { error: "forbidden" });
    if (code === "ZD409") return respond(409, { error: "conflict" });
    if (code === "ZD422") return respond(422, { error: "invalid_input" });
    console.error("comment request failed", action, typeof code === "string" && SQLSTATE.test(code) ? code : "unknown");
    return respond(503);
  }
}
