import { describe, expect, it, vi } from "vitest";

import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import type { SubmissionOutcome } from "./submission";
import { handleSubmissionRequest, submissionResponse, type SubmissionRouteDeps } from "./submission-route";

// B-12 step 4b2: invented ids; the database is a script of rows.
const ORIGIN = "http://localhost:3000";
const HEADERS = { origin: ORIGIN, "sec-fetch-site": "same-origin", "ductus-protocol": "1", "content-type": "application/json" };
const BODY = { documentId: "dokument-1", revision: 2 };

function post(body: unknown, headers: Record<string, string | undefined> = {}, method = "POST") {
  const merged = Object.fromEntries(Object.entries({ ...HEADERS, ...headers }).filter(([, v]) => v !== undefined)) as Record<string, string>;
  return new Request(`${ORIGIN}/api/submission`, {
    method,
    headers: merged,
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const signer: SigningKeyProvider = {
  sign: () => Promise.reject(new Error("unused")),
  verify: () => Promise.reject(new Error("unused")),
  publicVerificationKey: () => Promise.reject(new Error("unused")),
};

function setup(rows: { actor?: unknown; request?: unknown[] } = {}) {
  const queries: string[] = [];
  const withActor = vi.fn(async (_token: string | null, fn: (tx: ActorTransaction) => Promise<unknown>) => {
    const tx: ActorTransaction = {
      async query(text) {
        queries.push(text);
        const result = text.includes("current_user_id")
          ? [{ user_id: "actor" in rows ? rows.actor : "00000000-0000-4000-8000-0000000000e1" }]
          : (rows.request ?? []);
        return { rows: result as never[], rowCount: result.length };
      },
    };
    return fn(tx);
  });
  const log = vi.fn();
  const deps: SubmissionRouteDeps = {
    withActor: withActor as unknown as WithActor,
    payloads: new InMemoryEvidencePayloadStore(),
    signer,
    expectedOrigin: ORIGIN,
    sessionToken: "A".repeat(43),
    log,
  };
  return { deps, withActor, queries, log };
}

describe("POST /api/submission", () => {
  it.each<[string, Request, number, string]>([
    ["no Origin", post(BODY, { origin: undefined }), 403, "forbidden"],
    ["a foreign Origin", post(BODY, { origin: "https://drugi.example" }), 403, "forbidden"],
    ["a cross-site fetch", post(BODY, { "sec-fetch-site": "cross-site" }), 403, "forbidden"],
    ["a GET", post(BODY, {}, "GET"), 405, "method_not_allowed"],
    ["another protocol", post(BODY, { "ductus-protocol": "2" }), 426, "upgrade_required"],
    ["another media type", post(BODY, { "content-type": "text/plain" }), 415, "unsupported_media_type"],
  ])("refuses %s before reading the body or the database", async (_name, request, status, body) => {
    const { deps, withActor } = setup();
    const response = await handleSubmissionRequest(request, deps);
    expect([response.status, await response.json()]).toEqual([status, { status: body }]);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("answers no session cookie with 401 before the database", async () => {
    const { deps, withActor } = setup();
    const response = await handleSubmissionRequest(post(BODY), { ...deps, sessionToken: undefined });
    expect(response.status).toBe(401);
    expect(withActor).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ["a time from the client (A1)", { ...BODY, requestedAt: "2026-11-01T09:00:00.000Z" }],
    ["a document from the client (B2)", { ...BODY, document: "e30=" }],
    ["revision 0", { ...BODY, revision: 0 }],
    ["a revision as text", { ...BODY, revision: "2" }],
    ["a fractional revision", { ...BODY, revision: 1.5 }],
    ["an empty document id", { ...BODY, documentId: "" }],
    ["no revision", { documentId: "dokument-1" }],
    ["not JSON", "{"],
  ])("refuses %s as invalid, without the database", async (_name, body) => {
    const { deps, withActor } = setup();
    const response = await handleSubmissionRequest(post(body), deps);
    expect([response.status, await response.json()]).toEqual([422, { status: "invalid" }]);
    expect(withActor).not.toHaveBeenCalled();
  });

  it("tells an ended session (401) apart from a refusal (404), and asks no further", async () => {
    const ended = setup({ actor: null });
    const response = await handleSubmissionRequest(post(BODY), ended.deps);
    expect([response.status, await response.json()]).toEqual([401, { status: "unauthenticated" }]);
    expect(ended.queries).toHaveLength(1);

    const refused = setup({ request: [{ outcome: "unauthorized" }] });
    const other = await handleSubmissionRequest(post(BODY), refused.deps);
    expect([other.status, await other.json()]).toEqual([404, { status: "not_found" }]);
  });

  it.each<[unknown, number, Record<string, unknown>]>([
    [{ outcome: "stale_revision", revision: "3" }, 409, { status: "stale_revision", currentRevision: 3 }],
    [{ outcome: "not_acknowledged" }, 409, { status: "not_acknowledged" }],
    [{ outcome: "not_open" }, 409, { status: "not_open" }],
    [{ outcome: "no_evidence" }, 409, { status: "blocked", reason: "no_evidence" }],
    [{ outcome: "invalid" }, 422, { status: "invalid" }],
    [{ outcome: "later" }, 503, { status: "unavailable", stage: "request" }],
  ])("maps the request outcome %o, writing nothing more", async (row, status, body) => {
    const { deps, queries, log } = setup({ request: [row] });
    const response = await handleSubmissionRequest(post(BODY), deps);
    expect([response.status, await response.json()]).toEqual([status, body]);
    expect(queries.some((text) => text.includes("record_submission"))).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain("dokument-1");
  });

  it.each<[SubmissionOutcome, number, Record<string, unknown>]>([
    [{ status: "blocked", reason: "record_mismatch" }, 409, { status: "blocked", reason: "record_mismatch" }],
    [{ status: "blocked", reason: "segment_unsigned" }, 409, { status: "blocked", reason: "segment_unsigned" }],
    [{ status: "blocked", reason: "record_discontinuous" }, 409, { status: "blocked", reason: "record_discontinuous" }],
    [{ status: "unavailable", stage: "verification", code: "x" }, 503, { status: "unavailable", stage: "verification" }],
    [{ status: "unavailable", stage: "signing", code: "signing" }, 503, { status: "unavailable", stage: "signing" }],
    [{ status: "not_found" }, 404, { status: "not_found" }],
    [{ status: "unauthenticated" }, 401, { status: "unauthenticated" }],
    [{ status: "unknown" } as never, 503, { status: "unavailable", stage: "submission" }],
  ])("puts %o on the wire without a code, and an unknown status never as a success", async (outcome, status, body) => {
    const response = submissionResponse(outcome);
    expect([response.status, await response.json()]).toEqual([status, body]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (status === 503) expect(response.headers.get("retry-after")).toBe("5");
  });
});
