import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeJcs } from "@/domain/forensics/jcs";

import { listRevisionRequests, requestsFromList, respondRevisionRequest } from "./revision-requests";

const R1 = "aaaaaaaa-0000-4000-8000-000000000001";
const R2 = "aaaaaaaa-0000-4000-8000-000000000002";
const anchor = {
  nodeId: "0f8e2a64-1b3c-4d5e-8f60-718293a4b5c6", quote: "knjižnice", prefix: "Gradske ", suffix: " su",
  startHint: 8, endHint: 17,
};
const W = "2026-11-10T10:05:00.000Z";
const none = {
  response_kind: null, response_explanation: null, response_revision: null, response_is_own: null, response_window: null,
};
const open = { closed_as: null, closed_is_own: null, closed_window: null, accepted_revision: null, accepted_range_hash: null };
const answered = (kind = "done") => ({
  response_kind: kind, response_explanation: "Dodan izvor.", response_revision: 9, response_is_own: true, response_window: W,
});
const closed = (as: string) => ({
  closed_as: as, closed_is_own: false, closed_window: W,
  accepted_revision: as === "accepted" ? 9 : null, accepted_range_hash: null,
});

/** One row of `list` for version `version` of a request in `state` with `last` versions. */
function row(id: string, version: number, extra: Record<string, unknown> = {}, head: Record<string, unknown> = {}) {
  return {
    request_id: id, request_state: "open", request_version: 1, request_row_seq: 3, ...head,
    anchor: version === 1 ? anchor : null, version, instruction: `Uputa ${version}`, requested_revision: 4,
    opened_is_own: false, opened_window: W, ...none, ...open, ...extra,
  };
}

describe("requestsFromList: input classes", () => {
  it("valid: several requests, each with its versions in order, numbered as opened", () => {
    const reopened = { request_state: "reopened", request_version: 2, request_row_seq: 7 };
    const list = requestsFromList({
      requests: [
        row(R1, 1, { ...answered(), ...closed("reopened") }, reopened),
        row(R1, 2, {}, reopened),
        row(R2, 1, answered("declined"), { request_state: "responded", request_row_seq: 5 }),
      ],
    })!;
    expect(list.map((r) => [r.number, r.id, r.state, r.rowSeq, r.versions.length])).toEqual([
      [1, R1, "reopened", 7, 2],
      [2, R2, "responded", 5, 1],
    ]);
    expect(list[0]!.anchor).toEqual(anchor);
    expect(list[0]!.versions[0]!.closed).toEqual({ as: "reopened", isOwn: false, window: W, acceptedRevision: null });
    expect(list[0]!.versions[1]).toMatchObject({ instruction: "Uputa 2", response: null, closed: null });
    expect(list[1]!.versions[0]!.response).toEqual({
      kind: "declined", explanation: "Dodan izvor.", revision: 9, isOwn: true, window: W,
    });
  });

  it("valid: an empty list", () => {
    expect(requestsFromList({ requests: [] })).toEqual([]);
  });

  it("valid: every final state", () => {
    const accepted = requestsFromList({
      requests: [row(R1, 1, { ...answered(), ...closed("accepted") }, { request_state: "accepted" })],
    })!;
    expect(accepted[0]!.versions[0]!.closed?.acceptedRevision).toBe(9);
    const withdrawn = requestsFromList({ requests: [row(R1, 1, closed("withdrawn"), { request_state: "withdrawn" })] })!;
    expect(withdrawn[0]!.state).toBe("withdrawn");
  });

  it("keeps markup as plain text", () => {
    const list = requestsFromList({ requests: [row(R1, 1, { instruction: "<img src=x onerror=alert(1)>" })] })!;
    expect(list[0]!.versions[0]!.instruction).toBe("<img src=x onerror=alert(1)>");
  });

  const responded = { request_state: "responded" };
  it.each([
    ["not an object", null],
    ["an array", []],
    ["no requests", {}],
    ["requests not a list", { requests: {} }],
    ["row not an object", { requests: ["x"] }],
    ["unknown state", { requests: [row(R1, 1, {}, { request_state: "resolved" })] }],
    ["unknown response kind", { requests: [row(R1, 1, answered("maybe"), responded)] }],
    ["unknown closing", { requests: [row(R1, 1, closed("deleted"), { request_state: "withdrawn" })] }],
    ["missing field", { requests: [Object.fromEntries(Object.entries(row(R1, 1)).filter(([key]) => key !== "instruction"))] }],
    ["instruction not text", { requests: [row(R1, 1, { instruction: 5 })] }],
    ["own flag not boolean", { requests: [row(R1, 1, { opened_is_own: "false" })] }],
    ["bad time", { requests: [row(R1, 1, { opened_window: "jučer" })] }],
    ["bad id", { requests: [row("R1", 1)] }],
    ["row_seq zero", { requests: [row(R1, 1, {}, { request_row_seq: 0 })] }],
    ["row_seq as text", { requests: [row(R1, 1, {}, { request_row_seq: "3" })] }],
    ["row_seq fractional", { requests: [row(R1, 1, {}, { request_row_seq: 1.5 })] }],
    ["revision negative", { requests: [row(R1, 1, { requested_revision: -1 })] }],
    ["revision unsafe", { requests: [row(R1, 1, { requested_revision: 2 ** 53 })] }],
    ["anchor missing on version 1", { requests: [row(R1, 1, { anchor: null })] }],
    ["anchor out of shape", { requests: [row(R1, 1, { anchor: { ...anchor, extra: 1 } })] }],
    ["anchor on version 2", {
      requests: [row(R1, 1, closed("reopened"), { request_state: "reopened", request_version: 2 }),
        row(R1, 2, { anchor }, { request_state: "reopened", request_version: 2 })],
    }],
    ["version gap", {
      requests: [row(R1, 1, closed("reopened"), { request_version: 3, request_state: "reopened" }),
        row(R1, 3, {}, { request_version: 3, request_state: "reopened" })],
    }],
    ["fewer rows than versions", { requests: [row(R1, 1, {}, { request_version: 2, request_state: "reopened" })] }],
    ["request split apart", { requests: [row(R1, 1), row(R2, 1), row(R1, 1)] }],
    ["rows of one request disagree", {
      requests: [row(R1, 1, closed("reopened"), { request_version: 2, request_state: "reopened" }),
        row(R1, 2, {}, { request_version: 2, request_state: "reopened", request_row_seq: 4 })],
    }],
    ["half a response", { requests: [row(R1, 1, { ...answered(), response_window: null }, responded)] }],
    ["half a closing", { requests: [row(R1, 1, { ...closed("withdrawn"), closed_window: null }, { request_state: "withdrawn" })] }],
    ["accepted without revision", {
      requests: [row(R1, 1, { ...answered(), ...closed("accepted"), accepted_revision: null }, { request_state: "accepted" })],
    }],
    ["responded without a response", { requests: [row(R1, 1, {}, responded)] }],
    ["open with a response", { requests: [row(R1, 1, answered())] }],
    ["state and last closing disagree", { requests: [row(R1, 1, closed("withdrawn"), { request_state: "accepted" })] }],
    ["earlier version left open", {
      requests: [row(R1, 1, {}, { request_version: 2, request_state: "reopened" }),
        row(R1, 2, {}, { request_version: 2, request_state: "reopened" })],
    }],
    ["text longer than the limit", { requests: [row(R1, 1, { instruction: "a".repeat(2001) })] }],
  ])("refuses the whole list: %s", (_name, value) => {
    expect(requestsFromList(value)).toBeNull();
  });
});

describe("requestsFromList: classes of version history", () => {
  // Version 1 of a request reopened at version 2: what closed it, and whether it was answered.
  const second = { request_state: "reopened", request_version: 2 };
  const earlier = (extra: Record<string, unknown>) => [row(R1, 1, extra, second), row(R1, 2, {}, second)];
  // The only version of a request in `state`.
  const only = (state: string, extra: Record<string, unknown>) => [row(R1, 1, extra, { request_state: state })];

  it.each([
    ["earlier: not closed, unanswered", false, earlier({})],
    ["earlier: not closed, answered", false, earlier(answered())],
    ["earlier: reopened, unanswered", true, earlier(closed("reopened"))],
    ["earlier: reopened, answered", true, earlier({ ...answered(), ...closed("reopened") })],
    ["earlier: accepted, answered", true, earlier({ ...answered(), ...closed("accepted") })],
    ["earlier: accepted, unanswered", false, earlier(closed("accepted"))],
    ["earlier: withdrawn, unanswered", false, earlier(closed("withdrawn"))],
    ["earlier: withdrawn, answered", false, earlier({ ...answered(), ...closed("withdrawn") })],
    ["last: open", true, only("open", {})],
    ["last: open, answered", false, only("open", answered())],
    ["last: open, closed", false, only("open", closed("reopened"))],
    ["last: responded", true, only("responded", answered())],
    ["last: responded, unanswered", false, only("responded", {})],
    ["last: responded, closed", false, only("responded", { ...answered(), ...closed("accepted") })],
    ["last: accepted", true, only("accepted", { ...answered(), ...closed("accepted") })],
    ["last: accepted, unanswered", false, only("accepted", closed("accepted"))],
    ["last: withdrawn, unanswered", true, only("withdrawn", closed("withdrawn"))],
    ["last: withdrawn, answered", true, only("withdrawn", { ...answered(), ...closed("withdrawn") })],
    ["last: withdrawn, not closed", false, only("withdrawn", {})],
  ])("%s: valid %s", (_name, valid, rows) => {
    const list = requestsFromList({ requests: rows });
    if (valid) expect(list).not.toBeNull();
    else expect(list).toBeNull();
  });
});

describe("listRevisionRequests and respondRevisionRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number, body?: unknown) =>
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

  it("posts the exact JCS body of list and reads the requests", async () => {
    const fetchMock = answer(200, { requests: [row(R1, 1)] });
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await listRevisionRequests("doc-1");
    expect(outcome.kind).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/revision-requests/list");
    expect(init.body).toBe(canonicalizeJcs({ documentId: "doc-1" }));
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });

  it.each([
    [401, "signedOut"], [403, "forbidden"], [503, "unavailable"], [200, "unavailable"],
  ])("list answered %i is %s", async (status, kind) => {
    vi.stubGlobal("fetch", answer(status, status === 200 ? { requests: "x" } : { error: "x" }));
    expect((await listRevisionRequests("doc-1")).kind).toBe(kind);
  });

  it("list sends nothing once the session has ended", async () => {
    const fetchMock = answer(200, { requests: [] });
    vi.stubGlobal("fetch", fetchMock);
    expect((await listRevisionRequests("doc-1", () => false)).kind).toBe("signedOut");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("list that cannot reach the server is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect((await listRevisionRequests("doc-1")).kind).toBe("unavailable");
  });

  const input = { requestId: R1, expectedSeq: 3, kind: "done" as const, explanation: "Café dodan.", responseRevision: 9 };

  it("respond posts the read counter, never a computed one, in NFC", async () => {
    const fetchMock = answer(200, { outcome: "applied", row_seq: 4, version: 1, state: "responded" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await respondRevisionRequest(input)).toEqual({ kind: "ok" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/revision-requests/respond");
    expect(init.body).toBe(canonicalizeJcs({ ...input, explanation: "Café dodan." }));
  });

  it("a stale counter is a conflict with the current state, not a retry", async () => {
    const fetchMock = answer(409, { outcome: "conflict", row_seq: 5, version: 2, state: "reopened" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await respondRevisionRequest(input)).toEqual({ kind: "conflict", state: "reopened" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a transition the state no longer allows is a conflict without a state", async () => {
    vi.stubGlobal("fetch", answer(409, { error: "not_allowed" }));
    expect(await respondRevisionRequest(input)).toEqual({ kind: "conflict", state: null });
  });

  it.each([
    [401, "signedOut"], [403, "forbidden"], [422, "invalid"], [503, "unavailable"],
  ])("respond answered %i is %s", async (status, kind) => {
    vi.stubGlobal("fetch", answer(status, { error: "x" }));
    expect(await respondRevisionRequest(input)).toEqual({ kind });
  });

  it("respond refuses invalid input before any request", async () => {
    const fetchMock = answer(200, {});
    vi.stubGlobal("fetch", fetchMock);
    expect(await respondRevisionRequest({ ...input, explanation: "   " })).toEqual({ kind: "invalid" });
    expect(await respondRevisionRequest({ ...input, expectedSeq: 0 })).toEqual({ kind: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respond sends nothing once the session has ended", async () => {
    const fetchMock = answer(200, {});
    vi.stubGlobal("fetch", fetchMock);
    expect(await respondRevisionRequest(input, () => false)).toEqual({ kind: "signedOut" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
