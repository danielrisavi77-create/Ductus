import { describe, expect, it } from "vitest";

import { submitOutcomeFrom, submitWork, type SubmitInput } from "./submission";
import { RECEIPT } from "./submission.fixture";

// F-10 (#476 contract 6384297464, QA criteria 1 to 3). All data is invented.
const SENT: SubmitInput = { documentId: "doc-1", revision: 7 };

function recorder(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe("submission client (F-10)", () => {
  it("sends exactly the document and the revision, nothing else (criterion 1)", async () => {
    const r = recorder(200, { status: "submitted", receipt: RECEIPT });
    const outcome = await submitWork(SENT, () => true, r.fetcher);
    expect(outcome).toEqual({ kind: "submitted", receipt: RECEIPT });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toBe("/api/submission");
    expect(r.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(r.calls[0]!.init.body as string)).toEqual({ documentId: "doc-1", revision: 7 });
    expect(Object.keys(JSON.parse(r.calls[0]!.init.body as string))).toEqual(["documentId", "revision"]);
  });

  it("sends nothing once the session has ended here (criterion 7)", async () => {
    const r = recorder(200, { status: "submitted", receipt: RECEIPT });
    expect(await submitWork(SENT, () => false, r.fetcher)).toEqual({ kind: "signedOut" });
    expect(r.calls).toHaveLength(0);
  });

  it("is unavailable, never a throw, when the request fails", async () => {
    const fetcher = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect(await submitWork(SENT, () => true, fetcher)).toEqual({ kind: "unavailable" });
  });

  it("shows a receipt only for the exact signed shape naming what was sent (criterion 3)", () => {
    expect(submitOutcomeFrom(200, { status: "submitted", receipt: RECEIPT }, SENT).kind).toBe("submitted");
    const other = { ...RECEIPT, payload: { ...RECEIPT.payload, revision: 6 } };
    expect(submitOutcomeFrom(200, { status: "submitted", receipt: other }, SENT).kind).toBe("unavailable");
    const otherDoc = { ...RECEIPT, payload: { ...RECEIPT.payload, documentId: "doc-2" } };
    expect(submitOutcomeFrom(200, { status: "submitted", receipt: otherDoc }, SENT).kind).toBe("unavailable");
    expect(submitOutcomeFrom(200, { status: "submitted", receipt: { ...RECEIPT, extra: 1 } }, SENT).kind).toBe("unavailable");
    expect(submitOutcomeFrom(200, { status: "submitted" }, SENT).kind).toBe("unavailable");
    expect(submitOutcomeFrom(200, { status: "blocked", receipt: RECEIPT }, SENT).kind).toBe("unavailable");
    expect(submitOutcomeFrom(201, { status: "submitted", receipt: RECEIPT }, SENT).kind).toBe("unavailable");
    expect(submitOutcomeFrom(409, { status: "submitted", receipt: RECEIPT }, SENT).kind).toBe("unavailable");
  });

  it.each([
    [409, { status: "blocked", reason: "no_evidence" }, "noEvidence"],
    [409, { status: "blocked", reason: "record_mismatch" }, "recordMismatch"],
    [409, { status: "blocked", reason: "record_discontinuous" }, "blocked"],
    [409, { status: "blocked", reason: "segment_unsigned" }, "blocked"],
    [409, { status: "stale_revision", currentRevision: 8 }, "staleRevision"],
    [409, { status: "already_requested", revision: 5 }, "alreadyRequested"],
    [409, { status: "not_open" }, "notOpen"],
    [409, { status: "not_acknowledged" }, "notAcknowledged"],
    [409, { status: "something_new" }, "unavailable"],
    [401, { status: "unauthenticated" }, "signedOut"],
    [404, { status: "not_found" }, "notFound"],
    [422, { status: "invalid" }, "unavailable"],
    [503, { status: "unavailable", stage: "signing" }, "unavailable"],
    [500, undefined, "unavailable"],
  ] as const)("maps %i %j to %s", (status, body, kind) => {
    expect(submitOutcomeFrom(status, body, SENT).kind).toBe(kind);
  });
});
