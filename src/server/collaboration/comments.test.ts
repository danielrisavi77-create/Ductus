import { afterEach, describe, expect, it, vi } from "vitest";

import { handleCommentRequest, type CommentAction, type CommentDeps } from "./comments";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

const ORIGIN = "http://localhost:3000";
const TOKEN = "A".repeat(43);
const THREAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CANARY = "kanarinac-tijelo-7c1f";
const ANCHOR = {
  nodeId: "11111111-1111-4111-8111-111111111111",
  quote: `${CANARY}-sidro`,
  prefix: "",
  suffix: "",
  startHint: 0,
  endHint: 10,
};
const DOC = "doc-student-a-1";
const VALID: Record<CommentAction, Record<string, unknown>> = {
  create: { documentId: DOC, body: `Nastavnik N1: ${CANARY}`, anchor: ANCHOR },
  reply: { threadId: THREAD, body: `Student A: ${CANARY}` },
  resolve: { threadId: THREAD },
  reopen: { threadId: THREAD },
  list: { documentId: DOC },
};
const ROW = {
  thread_id: THREAD,
  comment_id: COMMENT,
  comment_position: 1,
  author_role: "teacher",
  is_own: false,
  body: "Nastavnik N1: dobar uvod.",
  anchor: ANCHOR,
  state: "open",
  created_window: new Date("2026-10-17T10:05:00Z"),
};

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/comments`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function port({ code, rows }: { code?: string; rows?: Record<string, unknown>[] } = {}) {
  const query = vi.fn(async () => {
    if (code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code });
    return { rows: rows ?? [{ id: THREAD }], rowCount: 1 };
  });
  const withActor = vi.fn(async (
    _token: string | null | undefined,
    fn: (tx: ActorTransaction) => Promise<unknown>,
  ) => fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
  const deps: CommentDeps = { withActor, expectedOrigin: ORIGIN, sessionToken: TOKEN };
  return { deps, withActor, query };
}

afterEach(() => vi.restoreAllMocks());

describe("B-10 / DAN-86 comment API contract", () => {
  it("creates a thread through one parameterized RPC; the anchor goes as jsonb, no identity", async () => {
    const { deps, withActor, query } = port();
    const res = await handleCommentRequest("create", request(VALID.create), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: THREAD });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(query).toHaveBeenCalledWith(
      "SELECT collaboration.create_comment($1, $2, $3::jsonb) AS id",
      [DOC, VALID.create.body, JSON.stringify(ANCHOR)],
    );
  });

  it("replies, resolves and reopens by thread id only", async () => {
    const reply = port({ rows: [{ id: COMMENT }] });
    expect(await (await handleCommentRequest("reply", request(VALID.reply), reply.deps)).json()).toEqual({ id: COMMENT });
    expect(reply.query).toHaveBeenCalledWith("SELECT collaboration.reply_comment($1::uuid, $2) AS id", [THREAD, VALID.reply.body]);
    for (const action of ["resolve", "reopen"] as const) {
      const { deps, query } = port({ rows: [{}] });
      const res = await handleCommentRequest(action, request(VALID[action]), deps);
      expect(res.status).toBe(204);
      expect(query).toHaveBeenCalledWith(`SELECT collaboration.${action}_thread($1::uuid)`, [THREAD]);
    }
  });

  it("lists comments in one shape for student and teacher, time only as the 5-minute window", async () => {
    const { deps, query } = port({ rows: [ROW, { ...ROW, comment_id: THREAD, comment_position: 2, author_role: "student", is_own: true, anchor: null, body: "Student A: hvala." }] });
    const res = await handleCommentRequest("list", request(VALID.list), deps);
    expect(res.status).toBe(200);
    const { comments } = await res.json();
    expect(comments).toHaveLength(2);
    expect(Object.keys(comments[0]).sort()).toEqual(
      ["anchor", "authorRole", "body", "commentId", "createdWindow", "isOwn", "position", "state", "threadId"],
    );
    expect(comments[0].createdWindow).toBe("2026-10-17T10:05:00.000Z");
    expect(comments[1].anchor).toBeNull();
    expect((query.mock.calls[0] as unknown[])[0]).toMatch(/FROM collaboration\.list_comments\(\$1\)$/);
  });

  it("refuses cross-site, missing session, wrong media type and oversized bodies before the database", async () => {
    const { deps, withActor } = port();
    expect((await handleCommentRequest("list", request(VALID.list, { origin: "https://evil.example" }), deps)).status).toBe(403);
    expect((await handleCommentRequest("list", request(VALID.list), { ...deps, sessionToken: "x" })).status).toBe(401);
    expect((await handleCommentRequest("list", request(VALID.list, { "content-type": "text/plain" }), deps)).status).toBe(415);
    const huge = { ...VALID.create, body: "a".repeat(16 * 1024) };
    expect((await handleCommentRequest("create", request(huge), deps)).status).toBe(413);
    expect((await handleCommentRequest("list", request("{oops"), deps)).status).toBe(400);
    expect(withActor).not.toHaveBeenCalled();
  });

  it.each([
    ["forged author", "reply", { ...VALID.reply, authorId: COMMENT }],
    ["forged role", "create", { ...VALID.create, role: "teacher" }],
    ["forged institution", "list", { ...VALID.list, institutionId: COMMENT }],
    ["thread id not a uuid", "resolve", { threadId: "1 OR 1=1" }],
    ["empty body", "reply", { ...VALID.reply, body: "" }],
    ["RTL override", "reply", { ...VALID.reply, body: "a\u202Eb" }],
    ["anchor with extra field", "create", { ...VALID.create, anchor: { ...ANCHOR, revision: 1 } }],
    ["missing anchor", "create", { documentId: DOC, body: "x" }],
    ["array", "list", [VALID.list]],
  ] as const)("refuses %s with 422 and without echo", async (_name, action, body) => {
    const { deps, withActor } = port();
    const res = await handleCommentRequest(action, request(body), deps);
    expect(res.status).toBe(422);
    expect(await res.text()).toBe(JSON.stringify({ error: "invalid_input" }));
    expect(withActor).not.toHaveBeenCalled();
  });

  it.each([
    ["ZD401", 401],
    ["ZD403", 403],
    ["ZD409", 409],
    ["ZD422", 422],
  ])("maps database refusal %s to %s with no detail", async (code, status) => {
    const { deps } = port({ code });
    const res = await handleCommentRequest("reply", request(VALID.reply), deps);
    expect(res.status).toBe(status);
    expect(await res.text()).not.toContain(CANARY);
  });

  it("fails closed on malformed RPC results", async () => {
    for (const [action, rows] of [
      ["create", [{ id: "not-a-uuid" }]],
      ["list", [{ ...ROW, author_role: "admin" }]],
      ["list", [{ ...ROW, created_window: "never" }]],
    ] as const) {
      const { deps } = port({ rows: [...rows] });
      expect((await handleCommentRequest(action, request(VALID[action]), deps)).status).toBe(503);
    }
  });

  it("logs only the action and error code, never body, anchor or ids (attack 11, canary)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const action of ["create", "reply", "list"] as const) {
      const { deps } = port({ code: "XX000" });
      const res = await handleCommentRequest(action, request(VALID[action]), deps);
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain(CANARY);
    }
    const logged = JSON.stringify(log.mock.calls);
    expect(log).toHaveBeenCalledWith("comment request failed", "create", "XX000");
    for (const secret of [CANARY, DOC, THREAD, ANCHOR.nodeId]) expect(logged).not.toContain(secret);
  });
});
