import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { handleEvidenceOpenRequest, type EvidenceOpenRouteDeps } from "./open-route";

const ORIGIN = "http://localhost:3000";
const ASSIGNMENT = "00000000-0000-4000-8000-0000000000f1";
const DOMAIN = "00000000-0000-4000-8000-0000000000d1";
const SNAPSHOT = '{"izmisljeno":"čćž"}';
const OPENED = {
  outcome: "opened",
  document_id: "dokument-1",
  evidence_profile_id: "standard-v1",
  current_revision: "2",
  document_hash: "a".repeat(64),
  head_segment_hash: "b".repeat(64),
  last_sequence_to: "7",
  snapshot: SNAPSHOT,
};
const KEY = (purpose: string, id: string) => ({
  key_id: id,
  key_version: "1",
  evidence_domain_id: DOMAIN,
  purpose,
  algorithm: "Ed25519",
  key_base64url: "javni-kljuc",
  valid_from: "2026-10-18T00:00:00.000Z",
  valid_to: null,
  revoked_at: null,
});
const HEADERS = { origin: ORIGIN, "sec-fetch-site": "same-origin", "ductus-protocol": "1", "content-type": "application/json" };

function post(body: unknown, headers: Record<string, string | undefined> = {}) {
  const merged = Object.fromEntries(Object.entries({ ...HEADERS, ...headers }).filter(([, v]) => v !== undefined)) as Record<string, string>;
  return new Request("http://localhost:3000/api/evidence/open", {
    method: "POST",
    headers: merged,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function setup(
  openRow: Record<string, unknown> | Error = OPENED,
  keys = [KEY("receipt", "k-r"), KEY("checkpoint", "k-c")],
  submittedRows: unknown[] = [{ submitted: false }],
) {
  const queries: { text: string; values: readonly unknown[] }[] = [];
  const withActor = vi.fn(async (_token: string | null, fn: (tx: ActorTransaction) => Promise<unknown>) => {
    const tx: ActorTransaction = {
      async query(text, values = []) {
        queries.push({ text, values });
        if (text.includes("open_student_work")) {
          if (openRow instanceof Error) throw openRow;
          return { rows: [openRow] as never[], rowCount: 1 };
        }
        if (text.includes("work_submitted")) return { rows: submittedRows as never[], rowCount: submittedRows.length };
        if (text.includes("evidence.package")) return { rows: [{ evidence_domain_id: DOMAIN }] as never[], rowCount: 1 };
        return { rows: keys as never[], rowCount: keys.length };
      },
    };
    return fn(tx);
  });
  const log = vi.fn();
  const deps: EvidenceOpenRouteDeps = { withActor: withActor as unknown as WithActor, expectedOrigin: ORIGIN, sessionToken: "A".repeat(43), log };
  return { deps, withActor, queries, log };
}

describe("POST /api/evidence/open", () => {
  it("opens the work with its state, its snapshot as base64 and only the domain's receipt keys", async () => {
    const { deps, queries } = setup();
    const response = await handleEvidenceOpenRequest(post({ assignmentId: ASSIGNMENT }), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      status: "opened",
      documentId: "dokument-1",
      evidenceProfileId: "standard-v1",
      currentRevision: 2,
      documentHash: "a".repeat(64),
      headSegmentHash: "b".repeat(64),
      lastSequenceTo: 7,
      document: Buffer.from(SNAPSHOT, "utf8").toString("base64"),
      receiptKeys: [expect.objectContaining({ keyId: "k-r", purpose: "receipt", evidenceDomainId: DOMAIN })],
      submitted: false,
    });
    // Neither package nor institution goes on the wire.
    expect(JSON.stringify(body)).not.toMatch(/package|institution/i);
    expect(queries.map((q) => q.values)).toEqual([[ASSIGNMENT, false], [ASSIGNMENT], ["dokument-1"], [DOMAIN]]);
    expect(queries[1]?.text).toMatch(/app\.work_submitted\(\$1::uuid\)/);
  });

  it.each([true, false])("carries submitted exactly as the database answers it (%s)", async (submitted) => {
    const { deps } = setup(OPENED, undefined, [{ submitted }]);
    const response = await handleEvidenceOpenRequest(post({ assignmentId: ASSIGNMENT }), deps);
    expect(response.status).toBe(200);
    expect((await response.json()).submitted).toBe(submitted);
  });

  it.each([
    ["a string", [{ submitted: "true" }]],
    ["a number", [{ submitted: 0 }]],
    ["null", [{ submitted: null }]],
    ["no column", [{}]],
    ["no row", []],
    ["two rows", [{ submitted: true }, { submitted: true }]],
  ] as const)("is unavailable when submitted is %s, never false by assumption", async (_, rows) => {
    const { deps, log } = setup(OPENED, undefined, [...rows]);
    const response = await handleEvidenceOpenRequest(post({ assignmentId: ASSIGNMENT }), deps);
    expect([response.status, await response.json()]).toEqual([503, { status: "unavailable", stage: "context" }]);
    expect(log).toHaveBeenCalledWith("evidence open", "unavailable", "context", "work_malformed");
  });

  it.each([
    ["no session", { outcome: "unauthenticated" }, 401, { status: "unauthenticated" }],
    ["not a student of it, or no such assignment", { outcome: "not_found" }, 404, { status: "not_found" }],
    ["the notice not acknowledged (#155 item 5)", { outcome: "not_accepting" }, 409, { status: "not_accepting" }],
    ["no work yet and no request to start one (F-137)", { outcome: "not_started" }, 409, { status: "not_started" }],
    ["no evidence domain", { outcome: "not_configured" }, 503, { status: "unavailable", stage: "context" }],
    ["an unknown outcome", { outcome: "otvoreno" }, 503, { status: "unavailable", stage: "context" }],
    ["a malformed revision", { ...OPENED, current_revision: "1.5" }, 503, { status: "unavailable", stage: "context" }],
    ["no snapshot", { ...OPENED, snapshot: null }, 503, { status: "unavailable", stage: "context" }],
    ["a fault", new Error("kanarinac-greska"), 503, { status: "unavailable", stage: "context" }],
  ] as const)("maps %s", async (_, row, status, expected) => {
    const { deps, queries, log } = setup(row as never);
    const response = await handleEvidenceOpenRequest(post({ assignmentId: ASSIGNMENT }), deps);
    expect([response.status, await response.json()]).toEqual([status, expected]);
    expect(queries).toHaveLength(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/kanarinac|dokument-1|00000000/);
  });

  it("is unavailable when a registry key is malformed, never a partial list", async () => {
    const { deps } = setup(OPENED, [KEY("receipt", "k-r"), { ...KEY("receipt", "k-2"), algorithm: "RSA" }]);
    const response = await handleEvidenceOpenRequest(post({ assignmentId: ASSIGNMENT }), deps);
    expect([response.status, await response.json()]).toEqual([503, { status: "unavailable", stage: "context" }]);
  });

  it.each([
    ["not a UUID", { assignmentId: "z1" }],
    ["an extra key", { assignmentId: ASSIGNMENT, studentId: ASSIGNMENT }],
    ["no key", {}],
    ["not JSON", "{"],
    ["start as null", { assignmentId: ASSIGNMENT, start: null }],
    ["start as a string", { assignmentId: ASSIGNMENT, start: "true" }],
    ["start as a number", { assignmentId: ASSIGNMENT, start: 1 }],
    ["start as an object", { assignmentId: ASSIGNMENT, start: {} }],
    ["start and an extra key", { assignmentId: ASSIGNMENT, start: true, studentId: ASSIGNMENT }],
    ["start without assignmentId", { start: true }],
  ])("refuses %s as invalid before any state", async (_, body) => {
    const { deps, withActor } = setup();
    const response = await handleEvidenceOpenRequest(post(body), deps);
    expect([response.status, await response.json()]).toEqual([422, { status: "invalid" }]);
    expect(withActor).not.toHaveBeenCalled();
  });

  // DAN-331 (F-137): only a literal true asks the database to make the work.
  it.each([
    ["no start", { assignmentId: ASSIGNMENT }, false],
    ["start false", { assignmentId: ASSIGNMENT, start: false }, false],
    ["start true", { assignmentId: ASSIGNMENT, start: true }, true],
    ["start true, keys in the other order", { start: true, assignmentId: ASSIGNMENT }, true],
  ] as const)("passes %s to the database as an explicit second argument", async (_, body, start) => {
    const { deps, queries } = setup();
    const response = await handleEvidenceOpenRequest(post(body), deps);
    expect(response.status).toBe(200);
    expect(queries[0]?.values).toEqual([ASSIGNMENT, start]);
    expect(queries[0]?.text).toMatch(/app\.open_student_work\(\$1::uuid, \$2::boolean\)/);
  });

  it("never lets the database default decide: the route source names both arguments", () => {
    const source = readFileSync(new URL("./open-route.ts", import.meta.url), "utf8");
    expect(source.match(/open_student_work\([^)]*\)/g)).toEqual(["open_student_work($1::uuid, $2::boolean)"]);
  });

  it.each([
    ["another Origin", { origin: "https://evil.example" }, 403],
    ["no Ductus-Protocol", { "ductus-protocol": undefined }, 426],
    ["text/plain", { "content-type": "text/plain" }, 415],
    ["a body over 1 KiB", { "content-length": "1025" }, 413],
  ] as const)("keeps the guards of the commit route: %s", async (_, headers, status) => {
    const { deps, withActor } = setup();
    const response = await handleEvidenceOpenRequest(post({ assignmentId: ASSIGNMENT }, headers), deps);
    expect(response.status).toBe(status);
    expect(withActor).not.toHaveBeenCalled();
  });
});
