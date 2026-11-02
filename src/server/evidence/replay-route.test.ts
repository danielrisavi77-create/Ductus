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

import { handleReplayRequest, type ReplayRouteDeps } from "./replay-route";

// Synthetic only: invented ids, Ana (owner) and Vesna (teacher), Lorem ipsum.
const ORIGIN = "http://localhost:3000";
const ANA = "A".repeat(43);
const VESNA = "V".repeat(43);
const DOCUMENT = "doc-ana-z1";
const PACKAGE = "pkg-ana-z1";
const FAK_A = "11111111-1111-4111-8111-111111111111";
const START_TEXT = '{"nodes":[],"schemaVersion":1}';

/** One segment starting from a document a checkpoint holds. */
async function record() {
  const start = await sha256WebCrypto(START_TEXT);
  const payload = canonicalEvidenceSegmentV2({
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: DOCUMENT,
    sessionId: "session-ana",
    segmentId: "segment-1",
    sequenceFrom: 1,
    sequenceTo: 1,
    observedStartedAt: "2026-10-20T10:00:00.000Z",
    observedEndedAt: "2026-10-20T10:00:00.000Z",
    initialDocumentHash: start,
    finalDocumentHash: "1".repeat(64),
    predecessorSegmentHash: null,
    events: [
      {
        sequence: 1,
        source: "editor",
        steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "Lorem ipsum" }] } }],
        beforeDocumentHash: start,
        afterDocumentHash: "1".repeat(64),
      },
    ],
    captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
    evidenceProfileId: "standard-v1",
  });
  const hash = await sha256WebCrypto(payload);
  const store = new InMemoryEvidencePayloadStore();
  await store.putImmutable({ institutionId: FAK_A, evidencePackageId: PACKAGE, segmentHash: hash, canonicalPayload: payload });
  return { store, hash, start, payload };
}

type Rows = Record<string, unknown>[] | Error;

/** A database stand-in: the same rows whoever asks, and a log of what was asked. */
function database(source: Rows, checkpoints: Rows = []) {
  const tokens: (string | null | undefined)[] = [];
  const queries: [string, unknown[]][] = [];
  const withActor = vi.fn(async (token, fn) => {
    tokens.push(token);
    const tx: ActorTransaction = {
      async query(text, values) {
        const rows = text.includes("read_replay_checkpoints") ? checkpoints : source;
        queries.push([text.includes("read_replay_checkpoints") ? "checkpoints" : "source", [...(values ?? [])]]);
        if (rows instanceof Error) throw rows;
        return { rows: structuredClone(rows), rowCount: rows.length } as never;
      },
    };
    return fn(tx);
  }) as unknown as WithActor;
  return { withActor, tokens, queries };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/evidence/replay`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(over: Partial<ReplayRouteDeps>): ReplayRouteDeps {
  return { withActor: database([]).withActor, payloads: STORAGE_NOT_CONFIGURED, expectedOrigin: ORIGIN, sessionToken: ANA, ...over };
}

const found = (hash: string) => [{ outcome: "found", institution_id: FAK_A, evidence_package_id: PACKAGE, segment_hashes: [hash] }];

afterEach(() => vi.restoreAllMocks());

describe("replay route R3: one page for the owner and the teacher (DAN-344)", () => {
  it("returns byte-identical JCS pages to Ana and Vesna, uncached, from the two read RPCs", async () => {
    const { store, hash, start, payload } = await record();
    const db = database(found(hash), [{ content_hash: start, body: START_TEXT }]);
    const answers = [];
    for (const sessionToken of [ANA, VESNA]) {
      answers.push(await handleReplayRequest(post({ documentId: DOCUMENT, from: 0 }),
        deps({ withActor: db.withActor, payloads: store, sessionToken })));
    }
    const [ana, vesna] = answers;
    expect(ana.status).toBe(200);
    expect(ana.headers.get("cache-control")).toBe("no-store");
    expect(ana.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const [anaBytes, vesnaBytes] = await Promise.all([ana.arrayBuffer(), vesna.arrayBuffer()]);
    expect(Buffer.from(vesnaBytes).equals(Buffer.from(anaBytes))).toBe(true);
    expect(JSON.parse(Buffer.from(anaBytes).toString("utf8"))).toMatchObject({
      segmentCount: 1, startDocument: START_TEXT, segments: [payload], next: null,
    });
    // Who asks reaches the database only as the session token.
    expect(db.tokens).toStrictEqual([ANA, ANA, VESNA, VESNA]);
    expect(db.queries.slice(0, 2)).toStrictEqual([["source", [DOCUMENT]], ["checkpoints", [DOCUMENT, [start]]]]);
  });

  it("maps every outcome to one closed answer without a detail in the log", async () => {
    const { store, hash, start } = await record();
    const zd = (code: string) => Object.assign(new Error("Lorem detail"), { code });
    const cases: [Rows, Rows, number, string][] = [
      [[{ outcome: "not_found" }], [], 404, "not_found"],
      [[{ outcome: "unavailable" }], [], 503, "unavailable"],
      [[], [], 503, "unavailable"],
      [zd("ZD401"), [], 401, "unauthorized"],
      [zd("ZD403"), [], 503, "unavailable"],
      [found(hash), zd("ZD401"), 401, "unauthorized"],
      [found(hash), zd("ZD422"), 503, "unavailable"],
      [found(hash), [], 503, "unavailable"],
      [found(hash), [{ content_hash: start, body: 7 }], 503, "unavailable"],
      [found(hash), [{ content_hash: start, body: START_TEXT }, { content_hash: start, body: START_TEXT }], 503, "unavailable"],
    ];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [source, checkpoints, status, error] of cases) {
      const response = await handleReplayRequest(post({ documentId: DOCUMENT, from: 0 }),
        deps({ withActor: database(source, checkpoints).withActor, payloads: store }));
      expect(response.status).toBe(status);
      expect(await response.json()).toStrictEqual({ error });
    }
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Lorem|doc-ana/);
  });

  it("refuses a request outside the contract before the database", async () => {
    const db = database(new Error("must not be reached"));
    const cases: [Request, Partial<ReplayRouteDeps>, number][] = [
      [post({ documentId: DOCUMENT, from: 0 }, { origin: "https://elsewhere.example", "sec-fetch-site": "cross-site" }), {}, 403],
      [post({ documentId: DOCUMENT, from: 0 }), { sessionToken: undefined }, 401],
      [post({ documentId: DOCUMENT, from: 0 }), { sessionToken: "short" }, 401],
      [post({ documentId: DOCUMENT, from: 0 }, { "content-type": "text/plain" }), {}, 415],
      [post("{"), {}, 400],
      [post({ documentId: DOCUMENT }), {}, 422],
      [post({ documentId: DOCUMENT, from: "0" }), {}, 422],
      [post({ documentId: DOCUMENT, from: 1.5 }), {}, 422],
      [post({ documentId: DOCUMENT, from: -1 }), {}, 422],
      [post({ documentId: DOCUMENT, from: 0, role: "teacher" }), {}, 422],
      [post([DOCUMENT, 0]), {}, 422],
      [post(JSON.stringify({ documentId: "x".repeat(1100), from: 0 })), {}, 413],
    ];
    for (const [request, over, status] of cases) {
      const response = await handleReplayRequest(request, deps({ withActor: db.withActor, ...over }));
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(db.tokens).toStrictEqual([]);
    // An id that cannot exist is answered like a missing document, without the database.
    const missing = await handleReplayRequest(post({ documentId: " doc", from: 0 }), deps({ withActor: db.withActor }));
    expect(missing.status).toBe(404);
    expect(db.tokens).toStrictEqual([]);
  });
});
