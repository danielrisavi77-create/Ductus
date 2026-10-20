import { describe, expect, it, vi } from "vitest";

import type { ProcessSummaryV1 } from "@/domain/projection/process-summary";

import { fetchProcessSummary, parseProcessSummaryV1 } from "./process-summary";

// Invented summary of an invented work: two sessions, one listed paste, one gap.
function summary(): ProcessSummaryV1 {
  return {
    summaryFormat: "ductus-process-summary-v1",
    sessions: {
      evidenceKind: "observed",
      breakAboveMinutes: 30,
      count: 2,
      items: [
        { from: "2026-10-19T08:00:00.000Z", to: "2026-10-19T08:41:00.000Z" },
        { from: "2026-10-19T12:05:00.000Z", to: "2026-10-19T12:20:00.000Z" },
      ],
    },
    pastes: {
      evidenceKind: "observed",
      listedAboveCharacters: 200,
      listed: [{ at: { from: "2026-10-19T08:10:00.000Z", to: "2026-10-19T08:11:00.000Z" }, characters: 412, origin: "not_observed" }],
      smallerCount: 3,
    },
    gaps: {
      evidenceKind: "observed",
      items: [{ previousEndedAt: "2026-10-19T08:41:00.000Z", nextStartedAt: "2026-10-19T12:05:00.000Z" }],
    },
    recordState: "has_gaps",
  };
}

const DOC = "11111111-2222-4333-8444-555555555555";

function reply(status: number, body?: string | Uint8Array) {
  return vi.fn<typeof fetch>(async () => new Response(status === 204 ? null : ((body ?? "{}") as BodyInit), { status }));
}

describe("parseProcessSummaryV1", () => {
  it("accepts exactly the summary the route returns and keeps its order", () => {
    expect(parseProcessSummaryV1(summary())).toEqual(summary());
    const complete = summary();
    complete.gaps.items = [];
    complete.recordState = "complete";
    expect(parseProcessSummaryV1(complete)?.recordState).toBe("complete");
  });

  // Object.assign writes values the type does not allow, as a hostile server would.
  const broken: [string, (s: ProcessSummaryV1) => void][] = [
    ["an extra top-level key, such as a role", (s) => { Object.assign(s, { viewerRole: "teacher" }); }],
    ["an extra nested key", (s) => { Object.assign(s.pastes, { share: 0.4 }); }],
    ["an extra key in a list item", (s) => { Object.assign(s.pastes.listed[0]!, { source: "web" }); }],
    ["a missing key", (s) => { delete (s as Partial<ProcessSummaryV1>).gaps; }],
    ["another format", (s) => { Object.assign(s, { summaryFormat: "ductus-process-summary-v2" }); }],
    ["another kind of evidence", (s) => { Object.assign(s.sessions, { evidenceKind: "declared" }); }],
    ["a count that is not the list length", (s) => { s.sessions.count = 3; }],
    ["a time that is not a whole minute", (s) => { s.sessions.items[0]!.from = "2026-10-19T08:00:30.000Z"; }],
    ["a time in another zone", (s) => { s.sessions.items[0]!.from = "2026-10-19T10:00:00.000+02:00"; }],
    ["a span that ends before it starts", (s) => { s.sessions.items[1] = { from: "2026-10-19T12:20:00.000Z", to: "2026-10-19T12:05:00.000Z" }; }],
    ["a listed paste at or under P-02", (s) => { s.pastes.listed[0]!.characters = 200; }],
    ["a paste with an observed origin", (s) => { Object.assign(s.pastes.listed[0]!, { origin: "web" }); }],
    ["a fraction", (s) => { s.pastes.smallerCount = 1.5; }],
    ["a negative count", (s) => { s.pastes.smallerCount = -1; }],
    ["a number as text", (s) => { Object.assign(s.sessions, { breakAboveMinutes: "30" }); }],
    ["P-01 of zero", (s) => { s.sessions.breakAboveMinutes = 0; }],
    ["a complete record with gaps", (s) => { s.recordState = "complete"; }],
    ["gaps claimed with none listed", (s) => { s.gaps.items = []; }],
    ["an unknown record state", (s) => { Object.assign(s, { recordState: "verified" }); }],
    ["a list that is not an array", (s) => { Object.assign(s.gaps, { items: {} }); }],
  ];
  it.each(broken)("refuses %s", (_name, change) => {
    const s = summary();
    change(s);
    expect(parseProcessSummaryV1(s)).toBeNull();
  });

  it("refuses values that are not a summary object", () => {
    for (const value of [null, [], "summary", 1, [summary()]]) expect(parseProcessSummaryV1(value)).toBeNull();
  });
});

describe("fetchProcessSummary", () => {
  it("sends only the document id, by POST with the session cookie", async () => {
    const fetcher = reply(200, JSON.stringify(summary()));
    expect(await fetchProcessSummary(DOC, () => true, fetcher)).toEqual({ kind: "ok", summary: summary() });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/process-summary");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ documentId: DOC });
  });

  it("sends nothing once the session has ended here", async () => {
    const fetcher = reply(200, JSON.stringify(summary()));
    expect(await fetchProcessSummary(DOC, () => false, fetcher)).toEqual({ kind: "signedOut" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, "signedOut"],
    [404, "notFound"],
    [400, "unavailable"],
    [415, "unavailable"],
    [422, "unavailable"],
    [503, "unavailable"],
    [500, "unavailable"],
    [204, "unavailable"],
    [302, "unavailable"],
  ])("answers %i as %s", async (status, kind) => {
    expect(await fetchProcessSummary(DOC, () => true, reply(status, '{"error":"x"}'))).toEqual({ kind });
  });

  it("never shows a 200 body that is not a valid summary", async () => {
    const extra = { ...summary(), role: "student" };
    for (const body of ["", "not json", JSON.stringify(extra), new Uint8Array([0x7b, 0xff, 0x7d])]) {
      expect(await fetchProcessSummary(DOC, () => true, reply(200, body))).toEqual({ kind: "unavailable" });
    }
  });

  it("answers a network failure as unavailable", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new TypeError("offline"); });
    expect(await fetchProcessSummary(DOC, () => true, fetcher)).toEqual({ kind: "unavailable" });
  });
});
