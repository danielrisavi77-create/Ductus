/**
 * The browser side of the comment route (F-9 step 1; route and RPCs: B-10,
 * docs/BACKEND.md 4.11). Every read and write goes through POST
 * /api/comments/<action>; the client never names an author, a role or an
 * institution, the database takes them from the session. A response that is
 * not exactly the documented shape is treated as unavailable, never shown.
 */

import { isTextAnchorInput, type TextAnchor } from "@/domain/collaboration";

export type CommentRole = "teacher" | "student";
export type ThreadState = "open" | "answered" | "resolved";

export type ThreadComment = {
  readonly id: string;
  readonly role: CommentRole;
  readonly isOwn: boolean;
  readonly body: string;
  /** Start of the 5-minute window (P-03) the comment was written in. */
  readonly createdWindow: string;
};

export type CommentThread = {
  readonly id: string;
  /** 1, 2, 3… in the order the threads were opened; threads are never deleted (B-10). */
  readonly number: number;
  readonly state: ThreadState;
  /** Null when the stored anchor is not a valid TextAnchor: shown, never placed. */
  readonly anchor: TextAnchor | null;
  readonly comments: readonly ThreadComment[];
};

export type ListOutcome =
  | { kind: "ok"; threads: CommentThread[] }
  | { kind: "signedOut" | "forbidden" | "unavailable" };

export type ReplyOutcome = "ok" | "signedOut" | "forbidden" | "conflict" | "invalid" | "unavailable";
export type CreateOutcome = "ok" | "signedOut" | "forbidden" | "invalid" | "unavailable";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ROLES: ReadonlySet<string> = new Set(["teacher", "student"]);
const STATES: ReadonlySet<string> = new Set(["open", "answered", "resolved"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Threads from the body of `list`, whose rows come ordered by thread and
 * position. Null for any row out of shape or out of order.
 */
export function threadsFromList(value: unknown): CommentThread[] | null {
  if (!isObject(value) || !Array.isArray(value.comments)) return null;
  const threads: { id: string; state: ThreadState; anchor: TextAnchor | null; comments: ThreadComment[] }[] = [];
  for (const row of value.comments as unknown[]) {
    if (!isObject(row)) return null;
    const { threadId, commentId, position, authorRole, isOwn, body, anchor, state, createdWindow } = row;
    if (typeof threadId !== "string" || !UUID.test(threadId) || typeof commentId !== "string" || !UUID.test(commentId)
      || typeof position !== "number" || !Number.isSafeInteger(position) || position < 1
      || typeof authorRole !== "string" || !ROLES.has(authorRole) || typeof isOwn !== "boolean"
      || typeof body !== "string" || typeof state !== "string" || !STATES.has(state)
      || typeof createdWindow !== "string" || Number.isNaN(Date.parse(createdWindow))) {
      return null;
    }
    const comment: ThreadComment = { id: commentId, role: authorRole as CommentRole, isOwn, body, createdWindow };
    const last = threads.at(-1);
    if (position === 1) {
      if (threads.some((t) => t.id === threadId)) return null;
      threads.push({
        id: threadId, state: state as ThreadState, anchor: isTextAnchorInput(anchor) ? anchor : null, comments: [comment],
      });
    } else if (last?.id === threadId && anchor === null && position === last.comments.length + 1) {
      last.comments.push(comment);
    } else {
      return null;
    }
  }
  return threads.map((t, index) => ({ ...t, number: index + 1 }));
}

async function post(
  action: "list" | "reply" | "create" | "resolve" | "reopen", input: Record<string, unknown>,
): Promise<Response | null> {
  try {
    return await fetch(`/api/comments/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export async function listComments(
  documentId: string, current: () => boolean = () => true,
): Promise<ListOutcome> {
  if (!current()) return { kind: "signedOut" };
  const response = await post("list", { documentId });
  if (response?.status === 401) return { kind: "signedOut" };
  if (response?.status === 403) return { kind: "forbidden" };
  if (!response || response.status !== 200) return { kind: "unavailable" };
  const threads = threadsFromList(await response.json().catch(() => null));
  return threads ? { kind: "ok", threads } : { kind: "unavailable" };
}

/**
 * `current` is asked right before the request: a reply typed under a session
 * that has since ended in this browser is never sent, since the cookie it
 * would carry may now be another person's (F-093).
 */
export async function replyComment(
  threadId: string, body: string, current: () => boolean = () => true,
): Promise<ReplyOutcome> {
  if (!current()) return "signedOut";
  const response = await post("reply", { threadId, body: body.normalize("NFC") });
  switch (response?.status) {
    case 200: return "ok";
    case 401: return "signedOut";
    case 403: return "forbidden";
    case 409: return "conflict";
    case 422: return "invalid";
    default: return "unavailable";
  }
}

/**
 * Opens a thread on a passage (teacher only; DAN-86 step 2c). The anchor is
 * made from the text the teacher sees; the route takes nothing else.
 */
export async function createComment(
  documentId: string, body: string, anchor: TextAnchor, current: () => boolean = () => true,
): Promise<CreateOutcome> {
  if (!current()) return "signedOut";
  const response = await post("create", { documentId, body: body.normalize("NFC"), anchor });
  switch (response?.status) {
    case 200: return "ok";
    case 401: return "signedOut";
    case 403: return "forbidden";
    case 422: return "invalid";
    default: return "unavailable";
  }
}

/** Marks a thread resolved or opens it again (teacher only); the route answers 204. */
export async function changeThreadState(
  threadId: string, action: "resolve" | "reopen", current: () => boolean = () => true,
): Promise<ReplyOutcome> {
  if (!current()) return "signedOut";
  const response = await post(action, { threadId });
  switch (response?.status) {
    case 204: return "ok";
    case 401: return "signedOut";
    case 403: return "forbidden";
    case 409: return "conflict";
    case 422: return "invalid";
    default: return "unavailable";
  }
}
