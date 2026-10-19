import { describe, expect, it, vi } from "vitest";

import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "@/domain/document/snapshot";
import { MAX_COMMIT_REQUEST_BYTES } from "@/domain/evidence/commit-envelope";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { commitResponse, handleEvidenceCommitRequest, type EvidenceCommitRouteDeps } from "./commit-route";
import type { EvidenceCommitRequestOutcome } from "./evidence-commit-request";

// The invented first segment of the golden chain and the document it ends in.
const chain = loadGoldenVectors().chain;
const golden = chain.segments[0];
const SEGMENT = Buffer.from(golden.canonicalUtf8Hex, "hex");
const final = chain.documentStates.find((state) => state.afterSequence === golden.segment.sequenceTo);
const DOCUMENT = Buffer.from(canonicalizeJcs(final?.value), "utf8");
const ORIGIN = "http://localhost:3000";
const TOKEN = "A".repeat(43);
const ENVELOPE = {
  documentId: golden.segment.documentId,
  clientTransactionId: "tx-izmisljeni-1",
  baseRevision: 3,
  segments: [SEGMENT.toString("base64")],
  document: DOCUMENT.toString("base64"),
};
const CONTEXT_ROW = {
  outcome: "ok",
  evidence_package_id: "paket-iz-baze-1",
  institution_id: "00000000-0000-4000-8000-0000000000a1",
  evidence_domain_id: "00000000-0000-4000-8000-0000000000d1",
  evidence_profile_id: golden.segment.evidenceProfileId,
  max_payload_bytes: 262144,
  transaction_known: false,
};
const STALE = { outcome: "stale_base", current_revision: "4", document_hash: "e".repeat(64), head_segment_hash: null, last_sequence_to: "8" };
const HEADERS = { origin: ORIGIN, "sec-fetch-site": "same-origin", "ductus-protocol": "1", "content-type": "application/json" };
const refusingSigner: SigningKeyProvider = {
  sign: () => Promise.reject(new Error("never")),
  verify: () => Promise.reject(new Error("never")),
  publicVerificationKey: () => Promise.reject(new Error("never")),
};

function post(body: unknown, headers: Record<string, string | undefined> = {}, method = "POST") {
  const merged = Object.fromEntries(Object.entries({ ...HEADERS, ...headers }).filter(([, v]) => v !== undefined)) as Record<string, string>;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost:3000/api/evidence/commit", { method, headers: merged, body: method === "GET" ? undefined : text });
}

/** A body that records being read; no guard may read it. */
function untouchedBody(headers: Record<string, string | undefined> = {}, method = "POST") {
  const state = { read: false };
  const body = new ReadableStream<Uint8Array>({
    pull() {
      state.read = true;
      throw new Error("read before the guards");
    },
  }, { highWaterMark: 0 });
  const merged = Object.fromEntries(Object.entries({ ...HEADERS, ...headers }).filter(([, v]) => v !== undefined)) as Record<string, string>;
  const init = { method, headers: merged, body: method === "GET" ? undefined : body, duplex: "half" } as RequestInit;
  return { request: new Request("http://localhost:3000/api/evidence/commit", init), state };
}

const LIVE = { user_id: "00000000-0000-4000-8000-0000000000e1", institution_id: CONTEXT_ROW.institution_id };

function setup(over: Partial<EvidenceCommitRouteDeps> = {}, session: object | Error = LIVE) {
  const events: string[] = [];
  const withActor = vi.fn(async (_token: string | null, fn: (tx: ActorTransaction) => Promise<unknown>) => {
    let kind = "";
    const tx: ActorTransaction = {
      async query(text) {
        kind = text.includes("current_actor") ? "session" : text.includes("evidence_commit_context") ? "context" : "commit";
        events.push(`${kind}:query`);
        if (kind === "session" && session instanceof Error) throw session;
        const row = kind === "session" ? session : kind === "context" ? CONTEXT_ROW : STALE;
        return { rows: [row] as never[], rowCount: 1 };
      },
    };
    const result = await fn(tx);
    events.push(`${kind}:end`);
    return result;
  });
  const payloads = {
    putImmutable: vi.fn(async () => {
      events.push("put");
      return { status: "stored" as const, storageRef: "memory:put-ref" };
    }),
    storageRefFor: vi.fn(async () => ({ status: "ok" as const, storageRef: "memory:known-ref" })),
  };
  const log = vi.fn();
  const deps: EvidenceCommitRouteDeps = {
    withActor: withActor as unknown as WithActor,
    signer: refusingSigner,
    payloads,
    expectedOrigin: ORIGIN,
    sessionToken: TOKEN,
    log,
    ...over,
  };
  return { deps, withActor, payloads, log, events };
}

describe("POST /api/evidence/commit: before the body", () => {
  it.each([
    ["a GET", {}, "GET", 405, "method_not_allowed"],
    ["no Origin (#155 item 8)", { origin: undefined }, "POST", 403, "forbidden"],
    ["another Origin", { origin: "https://evil.example" }, "POST", 403, "forbidden"],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }, "POST", 403, "forbidden"],
    ["no Ductus-Protocol", { "ductus-protocol": undefined }, "POST", 426, "upgrade_required"],
    ["Ductus-Protocol 2", { "ductus-protocol": "2" }, "POST", 426, "upgrade_required"],
    ["text/plain", { "content-type": "text/plain" }, "POST", 415, "unsupported_media_type"],
    ["a declared length over the limit (#155 item 12)", { "content-length": String(MAX_COMMIT_REQUEST_BYTES + 1) }, "POST", 413, "too_large"],
    ["a declared length that is not a number", { "content-length": "abc" }, "POST", 400, "bad_request"],
    ["a negative declared length", { "content-length": "-1" }, "POST", 400, "bad_request"],
    ["a declared length with a leading zero", { "content-length": "01" }, "POST", 400, "bad_request"],
  ] as const)("refuses %s without reading the body", async (_, headers, method, status, code) => {
    const { deps, withActor } = setup();
    const { request, state } = untouchedBody(headers, method);
    const response = await handleEvidenceCommitRequest(request, deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ status: code });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.read).toBe(false);
    expect(withActor).not.toHaveBeenCalled();
  });

  it.each([
    ["no session cookie (#155 item 9)", undefined],
    ["a cookie that is not a token", "kratki"],
  ])("answers 401 for %s without reading the body", async (_, sessionToken) => {
    const { deps, withActor } = setup({ sessionToken });
    const { request, state } = untouchedBody();
    const response = await handleEvidenceCommitRequest(request, deps);
    expect([response.status, await response.json()]).toEqual([401, { status: "unauthenticated" }]);
    expect(state.read).toBe(false);
    expect(withActor).not.toHaveBeenCalled();
  });

  it.each([
    ["a closed or expired session", { user_id: null, institution_id: null }, 401, { status: "unauthenticated" }],
    ["a session the database cannot answer for", new Error("down"), 503, { status: "unavailable", stage: "context" }],
  ] as const)("answers %s from the database before reading the body (F-098)", async (_, session, status, body) => {
    const { deps, events } = setup({}, session);
    const { request, state } = untouchedBody();
    const response = await handleEvidenceCommitRequest(request, deps);
    expect([response.status, await response.json()]).toEqual([status, body]);
    expect(state.read).toBe(false);
    expect(events).toEqual(status === 401 ? ["session:query", "session:end"] : ["session:query"]);
  });

  it("answers 503 context when the application origin is not configured", async () => {
    const { deps } = setup({ expectedOrigin: null });
    const { request, state } = untouchedBody();
    const response = await handleEvidenceCommitRequest(request, deps);
    expect([response.status, await response.json()]).toEqual([503, { status: "unavailable", stage: "context" }]);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(state.read).toBe(false);
  });

  it("derives the body limit from D-96 and the snapshot limit, base64 and 4 KiB of envelope", () => {
    const base64 = (n: number) => 4 * Math.ceil(n / 3);
    expect(MAX_COMMIT_REQUEST_BYTES).toBe(base64(MAX_EVIDENCE_SEGMENT_BYTES) + base64(MAX_DOCUMENT_SNAPSHOT_BYTES) + 4096);
  });
});

describe("POST /api/evidence/commit: the envelope", () => {
  const segment = ENVELOPE.segments[0];
  it.each([
    ["not JSON", "{"],
    ["a byte order mark before the JSON", `﻿${JSON.stringify(ENVELOPE)}`],
    ["an array", "[]"],
    ["an author field (#155 item 1)", { ...ENVELOPE, principalId: "drugi" }],
    ["a gap, not in version 1", { ...ENVELOPE, gap: { reason: "x" } }],
    ["a missing document", { ...ENVELOPE, document: undefined }],
    ["two segments", { ...ENVELOPE, segments: [segment, segment] }],
    ["no segment", { ...ENVELOPE, segments: [] }],
    ["a segment as an object", { ...ENVELOPE, segments: [{ bytes: segment }] }],
    ["base64 without padding", { ...ENVELOPE, document: "QQ" }],
    ["base64 that does not encode back", { ...ENVELOPE, document: "QR==" }],
    ["url-safe base64", { ...ENVELOPE, segments: [segment.replace(/\+/g, "-").replace(/\//g, "_") + "-_"] }],
    ["a revision as text", { ...ENVELOPE, baseRevision: "3" }],
  ])("refuses %s as invalid before any state, after the session only", async (_, body) => {
    const { deps, events } = setup();
    const response = await handleEvidenceCommitRequest(post(body), deps);
    expect([response.status, await response.json()]).toEqual([422, { status: "invalid" }]);
    expect(events).toEqual(["session:query", "session:end"]);
  });

  it("decodes the bytes and runs step 4d: context, then storage, then the transaction (F-097)", async () => {
    const { deps, payloads, events } = setup();
    const response = await handleEvidenceCommitRequest(post(ENVELOPE), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: "stale_base",
      currentRevision: 4,
      documentHash: "e".repeat(64),
      headSegmentHash: null,
      lastSequenceTo: 8,
    });
    expect(payloads.putImmutable).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ segmentHash: golden.segmentHash, canonicalPayload: SEGMENT.toString("utf8") }),
    );
    // The session before the body, and the context transaction ended before the object is written.
    expect(events).toEqual(["session:query", "session:end", "context:query", "context:end", "put", "commit:query", "commit:end"]);
  });
});

const RECEIPT = { payload: { receiptId: "r" }, payloadDigestSha256: "d", signature: { keyId: "k" } } as never;
const STATE = { currentRevision: 4, documentHash: "e".repeat(64), headSegmentHash: "f".repeat(64), lastSequenceTo: 8 };

describe("POST /api/evidence/commit: the outcomes on the wire (4.13 t. 4)", () => {
  it.each<[EvidenceCommitRequestOutcome, number, Record<string, unknown>]>([
    [{ status: "committed", revision: 5, signedReceipt: RECEIPT }, 200, { status: "committed", revision: 5, receipt: { status: "signed", signedReceipt: RECEIPT } }],
    [{ status: "duplicate", revision: 5, signedReceipt: RECEIPT }, 200, { status: "duplicate", revision: 5, receipt: { status: "signed", signedReceipt: RECEIPT } }],
    [{ status: "stale_base", state: STATE }, 409, { status: "stale_base", ...STATE }],
    [{ status: "chain_conflict", state: STATE }, 409, { status: "chain_conflict", ...STATE }],
    [{ status: "not_continuous", state: STATE }, 409, { status: "not_continuous", ...STATE }],
    [{ status: "txid_reused" }, 409, { status: "txid_reused" }],
    [{ status: "not_accepting" }, 409, { status: "not_accepting" }],
    [{ status: "invalid" }, 422, { status: "invalid" }],
    [{ status: "document_mismatch" }, 422, { status: "document_mismatch" }],
    [{ status: "too_large" }, 413, { status: "too_large" }],
    [{ status: "not_found" }, 404, { status: "not_found" }],
    [{ status: "unauthenticated" }, 401, { status: "unauthenticated" }],
    [{ status: "unavailable", stage: "signing", code: "signing_failed" }, 503, { status: "unavailable", stage: "signing" }],
    [{ status: "unavailable", stage: "storage", code: "storage_conflict" }, 503, { status: "unavailable", stage: "storage" }],
    [{ status: "unavailable", stage: "repository", code: "commit_failed" }, 503, { status: "unavailable", stage: "repository" }],
    [{ status: "unavailable", stage: "context", code: "context_failed" }, 503, { status: "unavailable", stage: "context" }],
    [{ status: "pending_signature" } as never, 503, { status: "unavailable", stage: "repository" }],
  ])("maps %j", async (outcome, status, body) => {
    const response = commitResponse(outcome);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe(status === 503 ? "5" : null);
  });
});

describe("POST /api/evidence/commit: the log (#155 item 31)", () => {
  it("carries the outcome, stage and code only, never ids, keys, bytes or text", async () => {
    const canary = ["kanarinac", Date.now().toString(36)].join("-");
    const document = canonicalizeJcs({ ...(final?.value as object), canary });
    const requests = [
      { ...ENVELOPE, documentId: canary },
      { ...ENVELOPE, clientTransactionId: canary },
      { ...ENVELOPE, document: Buffer.from(document).toString("base64") },
      { ...ENVELOPE, segments: [Buffer.from(canonicalizeJcs({ ...golden.segment, sessionId: canary })).toString("base64")] },
    ];
    const { deps, log, payloads } = setup();
    payloads.putImmutable.mockResolvedValue({ status: "unavailable", reason: canary } as never);
    const answers: unknown[] = [];
    for (const body of requests) answers.push(await (await handleEvidenceCommitRequest(post(body), deps)).json());
    answers.push(await (await handleEvidenceCommitRequest(post(ENVELOPE), deps)).json());
    expect(log).toHaveBeenCalled();
    const logged = JSON.stringify(log.mock.calls);
    for (const secret of [canary, ENVELOPE.clientTransactionId, ENVELOPE.documentId, ENVELOPE.segments[0], ENVELOPE.document]) {
      expect(logged).not.toContain(secret);
      expect(JSON.stringify(answers)).not.toContain(secret);
    }
    expect(log).toHaveBeenLastCalledWith("evidence commit", "unavailable", "storage", "storage_unavailable");
  });
});
