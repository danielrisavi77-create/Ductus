import { afterEach, describe, expect, it, vi } from "vitest";

import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
} from "@/domain/forensics/evidence-segment-v2";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { STORAGE_NOT_CONFIGURED } from "@/server/evidence/payload-reader";

import {
  handleProcessSummaryRequest,
  loadProcessSummaryThresholds,
  type ProcessSummaryRouteDeps,
} from "./process-summary";

// Synthetic only: invented ids, Ana (owner) and Vesna (teacher), Lorem ipsum.
const ORIGIN = "http://localhost:3000";
const ANA = "A".repeat(43);
const VESNA = "V".repeat(43);
const DOCUMENT = "doc-ana-z1";
const PACKAGE = "pkg-ana-z1";
const FAK_A = "11111111-1111-4111-8111-111111111111";
const FAK_B = "22222222-2222-4222-8222-222222222222";
const THRESHOLDS = { sessionBreakAboveMinutes: 30, pasteListedAboveCharacters: 200 };

async function record(documentId = DOCUMENT) {
  const hash = (n: number) => n.toString(16).padStart(64, "0");
  const payloads: string[] = [];
  const hashes: string[] = [];
  for (const [i, minute] of ["10:00", "10:20"].entries()) {
    const at = `2026-10-20T${minute}:00.000Z`;
    const payload = canonicalEvidenceSegmentV2({
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      canonicalization: EVIDENCE_CANONICALIZATION_V2,
      hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
      documentId,
      sessionId: "session-ana",
      segmentId: `segment-${i + 1}`,
      sequenceFrom: i + 1,
      sequenceTo: i + 1,
      observedStartedAt: at,
      observedEndedAt: at,
      initialDocumentHash: hash(i + 1),
      finalDocumentHash: hash(i + 2),
      predecessorSegmentHash: hashes.at(-1) ?? null,
      events: [
        {
          sequence: i + 1,
          source: i === 0 ? "editor" : "paste",
          steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "Lorem ipsum" }] } }],
          beforeDocumentHash: hash(i + 1),
          afterDocumentHash: hash(i + 2),
        },
      ],
      captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
      evidenceProfileId: "standard-v1",
    });
    payloads.push(payload);
    hashes.push(await sha256WebCrypto(payload));
  }
  const store = new InMemoryEvidencePayloadStore();
  for (const [i, canonicalPayload] of payloads.entries()) {
    await store.putImmutable({
      institutionId: FAK_A,
      evidencePackageId: PACKAGE,
      segmentHash: hashes[i],
      canonicalPayload,
    });
  }
  return { store, hashes };
}

/** A database stand-in: the same row whoever asks, and a log of who asked. */
function database(rows: Record<string, unknown>[] | Error) {
  const tokens: (string | null | undefined)[] = [];
  const queries: unknown[][] = [];
  const withActor = vi.fn(async (token, fn) => {
    tokens.push(token);
    const tx: ActorTransaction = {
      async query(_text, values) {
        queries.push([...(values ?? [])]);
        if (rows instanceof Error) throw rows;
        return { rows: structuredClone(rows), rowCount: rows.length } as never;
      },
    };
    return fn(tx);
  }) as unknown as WithActor;
  return { withActor, tokens, queries };
}

function post(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  return new Request(`${ORIGIN}/api/process-summary`, {
    method,
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

function deps(over: Partial<ProcessSummaryRouteDeps>): ProcessSummaryRouteDeps {
  return {
    withActor: database([]).withActor,
    payloads: STORAGE_NOT_CONFIGURED,
    thresholds: THRESHOLDS,
    expectedOrigin: ORIGIN,
    sessionToken: ANA,
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("process summary route: one body for the owner and the teacher (B-13, D-80 point 6)", () => {
  it("returns byte-identical JCS bodies to Ana and Vesna, uncached", async () => {
    const { store, hashes } = await record();
    const db = database([{ outcome: "found", institution_id: FAK_A, evidence_package_id: PACKAGE, segment_hashes: hashes }]);
    const answers = [];
    for (const sessionToken of [ANA, VESNA]) {
      answers.push(await handleProcessSummaryRequest(post({ documentId: DOCUMENT }),
        deps({ withActor: db.withActor, payloads: store, sessionToken })));
    }
    const [ana, vesna] = answers;
    expect(ana.status).toBe(200);
    expect(ana.headers.get("cache-control")).toBe("no-store");
    expect(ana.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const [anaBytes, vesnaBytes] = await Promise.all([ana.arrayBuffer(), vesna.arrayBuffer()]);
    expect(Buffer.from(vesnaBytes).equals(Buffer.from(anaBytes))).toBe(true);
    expect(JSON.parse(Buffer.from(anaBytes).toString("utf8"))).toMatchObject({
      sessions: { count: 1, breakAboveMinutes: 30 },
      recordState: "complete",
    });
    // Who asks reaches the database only as the session token.
    expect(db.tokens).toStrictEqual([ANA, VESNA]);
    expect(db.queries).toStrictEqual([[DOCUMENT], [DOCUMENT]]);
  });

  it("maps every source outcome to one closed answer", async () => {
    const cases: [Record<string, unknown>[] | Error, number, string][] = [
      [[{ outcome: "not_found", evidence_package_id: null, segment_hashes: null }], 404, "not_found"],
      [[{ outcome: "withheld", evidence_package_id: null, segment_hashes: null }], 503, "unavailable"],
      [[{ outcome: "unavailable", evidence_package_id: null, segment_hashes: null }], 503, "unavailable"],
      [[{ outcome: "found", institution_id: FAK_A, evidence_package_id: "Pkg!", segment_hashes: [] }], 503, "unavailable"],
      [[{ outcome: "found", institution_id: FAK_A, evidence_package_id: PACKAGE, segment_hashes: ["x"] }], 503, "unavailable"],
      ...[undefined, null, "", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "fak-a", 7].map(
        (institution_id): [Record<string, unknown>[], number, string] =>
          [[{ outcome: "found", institution_id, evidence_package_id: PACKAGE, segment_hashes: [] }], 503, "unavailable"],
      ),
      [[{ outcome: "maybe" }], 503, "unavailable"],
      [[], 503, "unavailable"],
      [new Error("relation evidence.segment Lorem ipsum"), 503, "unavailable"],
      // DAN-85: only ZD401 is the missing session; any other code stays unavailable.
      [Object.assign(new Error("not authenticated Lorem"), { code: "ZD401" }), 401, "unauthorized"],
      [Object.assign(new Error("forbidden Lorem"), { code: "ZD403" }), 503, "unavailable"],
      [Object.assign(new Error("Lorem"), { code: "zd401" }), 503, "unavailable"],
    ];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [rows, status, error] of cases) {
      const response = await handleProcessSummaryRequest(post({ documentId: DOCUMENT }), deps({ withActor: database(rows).withActor }));
      expect(response.status).toBe(status);
      expect(await response.json()).toStrictEqual({ error });
    }
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Lorem|doc-ana/);
  });

  // DAN-85 (#458 review point 1): like the comment and live-view reads.
  it("answers a session the database does not hold as open with 401, the same as no cookie", async () => {
    const closed = database(Object.assign(new Error("not authenticated"), { code: "ZD401" }));
    const expired = await handleProcessSummaryRequest(post({ documentId: DOCUMENT }), deps({ withActor: closed.withActor }));
    const noCookie = await handleProcessSummaryRequest(post({ documentId: DOCUMENT }), deps({ sessionToken: undefined }));
    expect(expired.status).toBe(401);
    expect(expired.headers.get("cache-control")).toBe("no-store");
    expect(await expired.json()).toStrictEqual(await noCookie.json());
    expect(closed.tokens).toStrictEqual([ANA]);
  });

  // B-13 step 4: the storage domain is the institution of the row read under withActor.
  it("reads payloads only in the institution the row names", async () => {
    const { store, hashes } = await record();
    const read = vi.spyOn(store, "readImmutable");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ours = database([{ outcome: "found", institution_id: FAK_A, evidence_package_id: PACKAGE, segment_hashes: hashes }]);
    const ok = await handleProcessSummaryRequest(post({ documentId: DOCUMENT }), deps({ withActor: ours.withActor, payloads: store }));
    expect(ok.status).toBe(200);
    expect(new Set(read.mock.calls.map(([input]) => input.institutionId))).toStrictEqual(new Set([FAK_A]));

    read.mockClear();
    const theirs = database([{ outcome: "found", institution_id: FAK_B, evidence_package_id: PACKAGE, segment_hashes: hashes }]);
    const refused = await handleProcessSummaryRequest(post({ documentId: DOCUMENT }), deps({ withActor: theirs.withActor, payloads: store }));
    expect(refused.status).toBe(503);
    expect(read.mock.calls.map(([input]) => input.institutionId)).toStrictEqual([FAK_B]);
  });

  it("answers a record with segments as unavailable when storage is not configured", async () => {
    const { hashes } = await record();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = database([{ outcome: "found", institution_id: FAK_A, evidence_package_id: PACKAGE, segment_hashes: hashes }]);
    const response = await handleProcessSummaryRequest(post({ documentId: DOCUMENT }), deps({ withActor: db.withActor }));
    expect(response.status).toBe(503);
  });
});

describe("process summary route guards, before the database", () => {
  it("refuses method, origin, session, media type and any field but documentId", async () => {
    const db = database([]);
    const cases: [Request, Partial<ProcessSummaryRouteDeps>, number][] = [
      [post(null, {}, "GET"), {}, 405],
      [post({ documentId: DOCUMENT }, { origin: "https://evil.example" }), {}, 403],
      [post({ documentId: DOCUMENT }, { "sec-fetch-site": "cross-site" }), {}, 403],
      [post({ documentId: DOCUMENT }), { sessionToken: undefined }, 401],
      [post({ documentId: DOCUMENT }), { sessionToken: "short" }, 401],
      [post({ documentId: DOCUMENT }, { "content-type": "text/plain" }), {}, 415],
      [post("{"), {}, 400],
      [post("x".repeat(2000)), {}, 413],
      [post({ documentId: DOCUMENT, asRole: "teacher" }), {}, 422],
      [post({ documentId: DOCUMENT, thresholds: { sessionBreakAboveMinutes: 1 } }), {}, 422],
      [post({ documentId: 7 }), {}, 422],
      [post([DOCUMENT]), {}, 422],
    ];
    for (const [request, over, status] of cases) {
      const response = await handleProcessSummaryRequest(request, deps({ ...over, withActor: db.withActor }));
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(db.withActor).not.toHaveBeenCalled();
  });

  it("answers an id that cannot exist as not found without asking the database", async () => {
    const db = database([]);
    for (const documentId of ["", " doc", "doc\u0000x", "x".repeat(257)]) {
      const response = await handleProcessSummaryRequest(post({ documentId }), deps({ withActor: db.withActor }));
      expect(response.status).toBe(404);
    }
    expect(db.withActor).not.toHaveBeenCalled();
  });

  it("is unavailable for everyone when the thresholds are misconfigured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = database([]);
    const response = await handleProcessSummaryRequest(post({ documentId: DOCUMENT }), deps({ withActor: db.withActor, thresholds: null }));
    expect(response.status).toBe(503);
    expect(db.withActor).not.toHaveBeenCalled();
  });
});

describe("loadProcessSummaryThresholds", () => {
  it("uses the DECISIONS defaults, takes whole numbers and refuses anything else", () => {
    expect(loadProcessSummaryThresholds({})).toStrictEqual(THRESHOLDS);
    expect(loadProcessSummaryThresholds({
      PROCESS_SUMMARY_SESSION_BREAK_MINUTES: "45",
      PROCESS_SUMMARY_PASTE_LISTED_CHARACTERS: "0",
    })).toStrictEqual({ sessionBreakAboveMinutes: 45, pasteListedAboveCharacters: 0 });
    for (const value of ["0", "-1", "1.5", "NaN", " 30", "1e3", "9999999"]) {
      expect(loadProcessSummaryThresholds({ PROCESS_SUMMARY_SESSION_BREAK_MINUTES: value })).toBeNull();
    }
    expect(loadProcessSummaryThresholds({ PROCESS_SUMMARY_PASTE_LISTED_CHARACTERS: "x" })).toBeNull();
  });
});
