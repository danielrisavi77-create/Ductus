import { afterEach, describe, expect, it, vi } from "vitest";

import type { TextAnchor } from "@/domain/collaboration";

import { changeThreadState, createComment, listComments, replyComment, threadsFromList } from "./comments";

const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "aaaaaaaa-0000-4000-8000-000000000002";
const anchor = {
  nodeId: "0f8e2a64-1b3c-4d5e-8f60-718293a4b5c6", quote: "knjižnice", prefix: "Gradske ", suffix: " su",
  startHint: 8, endHint: 17,
};
let n = 0;
const row = (threadId: string, position: number, extra: Record<string, unknown> = {}) => ({
  threadId, commentId: `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, "0")}`, position,
  authorRole: position === 1 ? "teacher" : "student", isOwn: position !== 1, body: `Tekst ${position}`,
  anchor: position === 1 ? anchor : null, state: "answered", createdWindow: "2026-10-18T10:05:00.000Z", ...extra,
});

describe("threadsFromList", () => {
  it("groups rows into numbered threads in order", () => {
    const threads = threadsFromList({ comments: [row(T1, 1), row(T1, 2), row(T2, 1, { state: "open" })] })!;
    expect(threads.map((t) => [t.number, t.id, t.state, t.comments.length])).toEqual([
      [1, T1, "answered", 2],
      [2, T2, "open", 1],
    ]);
    expect(threads[0]!.anchor).toEqual(anchor);
    expect(threads[0]!.comments[1]).toMatchObject({ role: "student", isOwn: true, body: "Tekst 2" });
  });

  it("keeps a thread whose stored anchor is out of shape, without a place", () => {
    const threads = threadsFromList({ comments: [row(T1, 1, { anchor: { ...anchor, extra: 1 } })] })!;
    expect(threads[0]!.anchor).toBeNull();
  });

  it("keeps a body with markup as plain text", () => {
    const threads = threadsFromList({ comments: [row(T1, 1, { body: "<script>alert(1)</script>" })] })!;
    expect(threads[0]!.comments[0]!.body).toBe("<script>alert(1)</script>");
  });

  it.each([
    ["not an object", null],
    ["no list", {}],
    ["unknown role", { comments: [row(T1, 1, { authorRole: "admin" })] }],
    ["unknown state", { comments: [row(T1, 1, { state: "closed" })] }],
    ["reply before its thread", { comments: [row(T1, 2)] }],
    ["gap in positions", { comments: [row(T1, 1), row(T1, 3)] }],
    ["anchor on a reply", { comments: [row(T1, 1), row(T1, 2, { anchor })] }],
    ["thread opened twice", { comments: [row(T1, 1), row(T2, 1), row(T1, 1)] }],
    ["bad id", { comments: [row("x", 1)] }],
    ["bad time", { comments: [row(T1, 1, { createdWindow: "jučer" })] }],
  ])("refuses the whole list: %s", (_name, value) => {
    expect(threadsFromList(value)).toBeNull();
  });
});

describe("listComments and replyComment", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number, body?: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })));

  it("posts only the document id and maps the answers", async () => {
    answer(200, { comments: [row(T1, 1)] });
    expect((await listComments("doc-1")).kind).toBe("ok");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/comments/list");
    expect(JSON.parse(String(init!.body))).toEqual({ documentId: "doc-1" });

    answer(403);
    expect(await listComments("doc-1")).toEqual({ kind: "forbidden" });
    answer(401);
    expect(await listComments("doc-1")).toEqual({ kind: "signedOut" });
    answer(200, { comments: [row(T1, 2)] });
    expect(await listComments("doc-1")).toEqual({ kind: "unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await listComments("doc-1")).toEqual({ kind: "unavailable" });
  });

  it("sends a reply in NFC with the thread id alone", async () => {
    answer(200, { id: T2 });
    expect(await replyComment(T1, "Hvala, dopunit ču.")).toBe("ok");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual({ threadId: T1, body: "Hvala, dopunit ču." });
    for (const [status, outcome] of [[401, "signedOut"], [403, "forbidden"], [409, "conflict"], [422, "invalid"], [503, "unavailable"]] as const) {
      answer(status);
      expect(await replyComment(T1, "Da.")).toBe(outcome);
    }
  });

  it("opens a thread with the document, the body in NFC and the anchor alone", async () => {
    answer(200, { id: T2 });
    expect(await createComment("doc-1", "Dodaj izvor.", anchor as TextAnchor)).toBe("ok");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/comments/create");
    expect(JSON.parse(String(init!.body))).toEqual({ documentId: "doc-1", body: "Dodaj izvor.", anchor });
    for (const [status, outcome] of [[401, "signedOut"], [403, "forbidden"], [422, "invalid"], [503, "unavailable"]] as const) {
      answer(status);
      expect(await createComment("doc-1", "Da.", anchor as TextAnchor)).toBe(outcome);
    }
  });

  it("resolves and reopens a thread by its id, 204 being success", async () => {
    answer(204);
    expect(await changeThreadState(T1, "resolve")).toBe("ok");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/comments/resolve");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual({ threadId: T1 });
    answer(204);
    expect(await changeThreadState(T1, "reopen")).toBe("ok");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/comments/reopen");
    for (const [status, outcome] of [[200, "unavailable"], [401, "signedOut"], [403, "forbidden"], [409, "conflict"], [503, "unavailable"]] as const) {
      answer(status);
      expect(await changeThreadState(T1, "resolve")).toBe(outcome);
    }
  });

  it("sends nothing once the session of the page has ended (F-093)", async () => {
    answer(200, { id: T2 });
    expect(await createComment("doc-1", "Da.", anchor as TextAnchor, () => false)).toBe("signedOut");
    expect(await changeThreadState(T1, "resolve", () => false)).toBe("signedOut");
    expect(await replyComment(T1, "Da.", () => false)).toBe("signedOut");
    expect(await listComments("doc-1", () => false)).toEqual({ kind: "signedOut" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
