import { afterEach, describe, expect, it, vi } from "vitest";

import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import { readProcessSummary } from "@/application/projection/process-summary-reader";
import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";
import { headingNode, paragraphNode, textNode, type NodeId } from "@/domain/document/schema";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
} from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";
import { STORAGE_NOT_CONFIGURED } from "@/server/evidence/payload-reader";
import { handleProcessSummaryRequest } from "@/server/projection/process-summary";

import { handleFastPathRequest, readFastPath, type FastPathRouteDeps } from "./fast-path";

// Synthetic only: invented ids and names (Ana Testić, Čedo Izmišljeni, Branka
// Primjer), Vesna the teacher, Lorem ipsum text.
const ORIGIN = "http://localhost:3000";
const VESNA = "V".repeat(43);
const ASSIGNMENT = "33333333-3333-4333-8333-333333333333";
const FAK_A = "11111111-1111-4111-8111-111111111111";
const PACKAGE = "pkg-ana-z1";
const THRESHOLDS = { sessionBreakAboveMinutes: 30, pasteListedAboveCharacters: 200 };
const STUDENT = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const NODE = (n: number) => `00000000-0000-4000-8000-${(100 + n).toString().padStart(12, "0")}` as NodeId;

const BODY = canonicalizeJcs({
  schemaVersion: 1,
  nodes: [
    headingNode(NODE(1), 1, [textNode("Uvod")]),
    paragraphNode(NODE(2), [textNode("Lorem ipsum "), textNode("dolor", ["italic"])]),
  ],
});

async function record(documentId: string) {
  const hash = (n: number) => n.toString(16).padStart(64, "0");
  const store = new InMemoryEvidencePayloadStore();
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
    const segmentHash = await sha256WebCrypto(payload);
    await store.putImmutable({ institutionId: FAK_A, evidencePackageId: PACKAGE, segmentHash, canonicalPayload: payload });
    hashes.push(segmentHash);
  }
  return { store, hashes };
}

type Row = Record<string, unknown>;

function work(n: number, hashes: string[], over: Row = {}): Row {
  return {
    student_id: STUDENT(n),
    given_name: "Ana",
    family_name: "Testić",
    document_id: `doc-${n}`,
    submitted: false,
    revision: "7",
    evidence_package_id: PACKAGE,
    head_segment_hash: hashes.at(-1) ?? null,
    segment_hashes: hashes,
    body: BODY,
    institution_id: FAK_A,
    ...over,
  };
}

function pending(n: number, over: Row = {}): Row {
  return {
    student_id: STUDENT(n),
    given_name: "Branka",
    family_name: "Primjer",
    document_id: null,
    submitted: null,
    revision: null,
    evidence_package_id: null,
    head_segment_hash: null,
    segment_hashes: null,
    body: null,
    institution_id: FAK_A,
    ...over,
  };
}

/** A database stand-in: each call answers the next row set, or throws. */
function database(...answers: (Row[] | Error)[]) {
  const queries: unknown[][] = [];
  const tokens: unknown[] = [];
  const withActor = vi.fn(async (token, fn) => {
    tokens.push(token);
    const answer = answers[Math.min(queries.length, answers.length - 1)];
    const tx: ActorTransaction = {
      async query(_text, values) {
        queries.push([...(values ?? [])]);
        if (answer instanceof Error) throw answer;
        return { rows: structuredClone(answer), rowCount: answer.length } as never;
      },
    };
    return fn(tx);
  }) as unknown as WithActor;
  return { withActor, queries, tokens };
}

function failure(code: string, message = "Ana Testić doc-1") {
  return Object.assign(new Error(message), { code });
}

function logger() {
  const lines: string[][] = [];
  return { lines, log: (message: string, code: string) => void lines.push([message, code]) };
}

function post(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  return new Request(`${ORIGIN}/api/teacher/fast-path`, {
    method,
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

function deps(over: Partial<FastPathRouteDeps>): FastPathRouteDeps {
  return {
    withActor: database([]).withActor,
    payloads: STORAGE_NOT_CONFIGURED,
    thresholds: THRESHOLDS,
    expectedOrigin: ORIGIN,
    sessionToken: VESNA,
    log: () => undefined,
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("readFastPath (B-11c, #757 D1 and D5)", () => {
  it("gives each student, the text as blocks and the four-line record, in Croatian surname order", async () => {
    const { store, hashes } = await record("doc-1");
    const db = database([
      work(1, hashes, { document_id: "doc-1", given_name: "Ana", family_name: "Testić", submitted: true }),
      pending(2, { given_name: null, family_name: null }),
      pending(3, { given_name: "Čedo", family_name: "Izmišljeni" }),
      pending(4, { given_name: "Cvita", family_name: "Izmišljeni" }),
      pending(5),
    ]);
    const read = await readFastPath(VESNA, ASSIGNMENT, db.withActor, { payloads: store, thresholds: THRESHOLDS });
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(read.students.map((s) => [s.surname, s.givenName])).toStrictEqual([
      ["Izmišljeni", "Cvita"],
      ["Izmišljeni", "Čedo"],
      ["Primjer", "Branka"],
      ["Testić", "Ana"],
      [null, null],
    ]);
    const ana = read.students[3]!;
    expect(ana).toMatchObject({ id: STUDENT(1), work: "submitted", lastChangeAt: "2026-10-20T10:20:00.000Z" });
    expect(ana.record).toMatchObject({
      pastesWithoutSource: 1,
      blocks: [{ kind: "heading", text: "Uvod" }, { kind: "paragraph", text: "Lorem ipsum dolor" }],
    });
    expect(read.students[2]).toStrictEqual({
      id: STUDENT(5), givenName: "Branka", surname: "Primjer", work: "notice_pending", lastChangeAt: null, record: null,
    });
    // The reader reaches the database only as the session, the assignment as a parameter.
    expect(db.tokens).toStrictEqual([VESNA]);
    expect(db.queries).toStrictEqual([[ASSIGNMENT]]);
  });

  it("gives the summary the student is shown, at function and route level (D-80 point 6)", async () => {
    const { store, hashes } = await record("doc-1");
    const fast = await readFastPath(VESNA, ASSIGNMENT, database([work(1, hashes, { document_id: "doc-1" })]).withActor, {
      payloads: store,
      thresholds: THRESHOLDS,
    });
    const source = { status: "found" as const, institutionId: FAK_A, evidencePackageId: PACKAGE,
      head: { segmentHash: hashes[1]!, segmentCount: 2 }, segmentHashes: hashes };
    const student = await readProcessSummary(
      { source: { readSource: async () => source }, payloads: store, thresholds: THRESHOLDS },
      "doc-1",
    );
    const route = await handleProcessSummaryRequest(post({ documentId: "doc-1" }), {
      withActor: database([{ outcome: "found", institution_id: FAK_A, evidence_package_id: PACKAGE, segment_hashes: hashes }])
        .withActor,
      payloads: store,
      thresholds: THRESHOLDS,
      expectedOrigin: ORIGIN,
      sessionToken: "A".repeat(43),
    });
    expect(fast.kind === "ok" && student.status === "ok").toBe(true);
    if (fast.kind !== "ok" || student.status !== "ok") return;
    const summary = fast.students[0]!.record!.summary;
    expect(canonicalizeJcs(summary)).toBe(student.body);
    expect(canonicalizeJcs(summary)).toBe(await route.text());
  });

  it("reads once more when the listing does not end at the head, then gives the second answer", async () => {
    const { store, hashes } = await record("doc-1");
    const stale = work(1, hashes.slice(0, 1), { document_id: "doc-1", head_segment_hash: hashes[1] });
    const db = database([stale], [work(1, hashes, { document_id: "doc-1" })]);
    const read = await readFastPath(VESNA, ASSIGNMENT, db.withActor, { payloads: store, thresholds: THRESHOLDS });
    expect(read.kind).toBe("ok");
    expect(db.queries).toHaveLength(2);
  });

  it("gives unavailable after two reads that do not match, never a partial list", async () => {
    const { store, hashes } = await record("doc-1");
    const stale = work(1, hashes.slice(0, 1), { document_id: "doc-1", head_segment_hash: hashes[1] });
    const { lines, log } = logger();
    const db = database([pending(2), stale]);
    const read = await readFastPath(VESNA, ASSIGNMENT, db.withActor, { payloads: store, thresholds: THRESHOLDS, log });
    expect(read).toStrictEqual({ kind: "unavailable" });
    expect(db.queries).toHaveLength(2);
    expect(lines).toStrictEqual([["fast path read failed", "head_mismatch"]]);
  });

  it.each<[string, Row]>([
    ["one name of the pair", pending(2, { given_name: null })],
    ["an empty name", pending(2, { family_name: "" })],
    ["a name over 255 characters", pending(2, { family_name: "x".repeat(256) })],
    ["a student id that is no UUID", pending(2, { student_id: "ana" })],
    ["a pending row with a body", pending(2, { body: BODY })],
    ["a revision that is no number", work(1, [], { revision: "-1" })],
    ["an institution that is no UUID", work(1, [], { institution_id: "fak-a" })],
    ["a package id outside the format", work(1, [], { evidence_package_id: "../pkg" })],
    ["a hash outside the format", work(1, ["AB"], { head_segment_hash: "AB" })],
    ["no submission flag", work(1, [], { submitted: null })],
    ["no body", work(1, [], { body: null })],
  ])("gives unavailable for a row with %s", async (_, row) => {
    const { lines, log } = logger();
    const read = await readFastPath(VESNA, ASSIGNMENT, database([pending(5), row]).withActor, {
      payloads: STORAGE_NOT_CONFIGURED,
      thresholds: THRESHOLDS,
      log,
    });
    expect(read).toStrictEqual({ kind: "unavailable" });
    expect(lines).toStrictEqual([["fast path read failed", "row_malformed"]]);
  });

  it("gives unavailable for a text that is not the exact JCS of a document", async () => {
    const { lines, log } = logger();
    const body = JSON.stringify(JSON.parse(BODY), null, 1);
    const read = await readFastPath(VESNA, ASSIGNMENT, database([work(1, [], { body })]).withActor, {
      payloads: STORAGE_NOT_CONFIGURED,
      thresholds: THRESHOLDS,
      log,
    });
    expect(read).toStrictEqual({ kind: "unavailable" });
    expect(lines).toStrictEqual([["fast path read failed", "text_malformed"]]);
  });

  it("gives unavailable when the record cannot be read, with the reader's closed code", async () => {
    const { hashes } = await record("doc-1");
    const { lines, log } = logger();
    const read = await readFastPath(VESNA, ASSIGNMENT, database([work(1, hashes, { document_id: "doc-1" })]).withActor, {
      payloads: new InMemoryEvidencePayloadStore(),
      thresholds: THRESHOLDS,
      log,
    });
    expect(read).toStrictEqual({ kind: "unavailable" });
    expect(lines).toHaveLength(1);
    expect(lines[0]![1]).toMatch(/^[a-z_]+$/);
  });

  it("gives unauthorized for no open session and logs nothing", async () => {
    const { lines, log } = logger();
    const read = await readFastPath(VESNA, ASSIGNMENT, database(failure("ZD401")).withActor, {
      payloads: STORAGE_NOT_CONFIGURED, thresholds: THRESHOLDS, log,
    });
    expect(read).toStrictEqual({ kind: "unauthorized" });
    expect(lines).toStrictEqual([]);
  });

  it.each([
    ["ZD503", "ZD503"],
    ["an error with no code", undefined],
    ["a code outside SQLSTATE", "Ana Testić"],
  ])("logs only a closed code for %s, never a name, a text or an id", async (_, code) => {
    const { lines, log } = logger();
    const error = code === undefined ? new Error("Ana Testić doc-1") : failure(code);
    const read = await readFastPath(VESNA, ASSIGNMENT, database(error).withActor, {
      payloads: STORAGE_NOT_CONFIGURED, thresholds: THRESHOLDS, log,
    });
    expect(read).toStrictEqual({ kind: "unavailable" });
    expect(lines).toStrictEqual([["fast path read failed", code === "ZD503" ? "ZD503" : "unknown"]]);
    expect(JSON.stringify(lines)).not.toMatch(/Ana|Testić|doc-1|VVVV|3333/);
  });

  it("refuses a malformed session token without reaching the database", async () => {
    const db = database([]);
    expect(await readFastPath("short", ASSIGNMENT, db.withActor, { payloads: STORAGE_NOT_CONFIGURED, thresholds: THRESHOLDS }))
      .toStrictEqual({ kind: "unauthorized" });
    expect(db.queries).toStrictEqual([]);
  });
});

describe("fast path route (B-11c, #757 D4)", () => {
  async function refused(response: Response, status: number, error: string) {
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toStrictEqual({ error });
  }

  it("answers 200 with the list, uncached, and passes the id lowercased", async () => {
    const db = database([pending(2)]);
    const response = await handleFastPathRequest(post({ assignmentId: ASSIGNMENT.toUpperCase() }), deps({ withActor: db.withActor }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toStrictEqual({
      kind: "ok",
      students: [{ id: STUDENT(2), givenName: "Branka", surname: "Primjer", work: "notice_pending", lastChangeAt: null, record: null }],
    });
    expect(db.queries).toStrictEqual([[ASSIGNMENT]]);
  });

  it("answers the same empty 200 for an assignment the reader does not teach or that does not exist", async () => {
    const response = await handleFastPathRequest(post({ assignmentId: ASSIGNMENT }), deps({ withActor: database([]).withActor }));
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ kind: "ok", students: [] });
  });

  it("refuses another method, origin or site", async () => {
    await refused(await handleFastPathRequest(post(null, {}, "GET"), deps({})), 405, "method_not_allowed");
    await refused(await handleFastPathRequest(post({ assignmentId: ASSIGNMENT }, { origin: "https://evil.example" }), deps({})), 403, "origin_mismatch");
    await refused(await handleFastPathRequest(post({ assignmentId: ASSIGNMENT }, { "sec-fetch-site": "cross-site" }), deps({})), 403, "cross_site");
  });

  it("refuses a reader with no session, before the body is read", async () => {
    const db = database([]);
    await refused(await handleFastPathRequest(post("{"), deps({ withActor: db.withActor, sessionToken: undefined })), 401, "unauthorized");
    await refused(await handleFastPathRequest(post({ assignmentId: ASSIGNMENT }), deps({ withActor: database(failure("ZD401")).withActor })), 401, "unauthorized");
    expect(db.queries).toStrictEqual([]);
  });

  it("refuses another media type, a body over the limit and a body that is not JSON", async () => {
    await refused(await handleFastPathRequest(post({ assignmentId: ASSIGNMENT }, { "content-type": "text/plain" }), deps({})), 415, "unsupported_media_type");
    await refused(await handleFastPathRequest(post({ assignmentId: ASSIGNMENT, pad: "x".repeat(2000) }), deps({})), 413, "body_too_large");
    await refused(await handleFastPathRequest(post("{"), deps({})), 400, "invalid_json");
  });

  it.each<[string, unknown]>([
    ["no assignment", {}],
    ["an id that is no UUID", { assignmentId: "z1" }],
    ["an id that is no string", { assignmentId: 7 }],
    ["a second key", { assignmentId: ASSIGNMENT, teacherId: STUDENT(9) }],
    ["an array", [ASSIGNMENT]],
    ["null", null],
  ])("refuses a body with %s as 422, without reaching the database", async (_, body) => {
    const db = database([]);
    await refused(await handleFastPathRequest(post(body), deps({ withActor: db.withActor })), 422, "invalid_input");
    expect(db.queries).toStrictEqual([]);
  });

  it("answers 503 for invalid thresholds or an unreadable read, never a partial list", async () => {
    await refused(await handleFastPathRequest(post({ assignmentId: ASSIGNMENT }), deps({ thresholds: null })), 503, "unavailable");
    await refused(
      await handleFastPathRequest(post({ assignmentId: ASSIGNMENT }), deps({ withActor: database([pending(2), pending(3, { body: BODY })]).withActor })),
      503,
      "unavailable",
    );
  });

  it("shows what the window holds: one revision within P-03, the newer one after it (D3)", async () => {
    // RPC stand-in for app.fast_path_works: it keeps the revision of the
    // window's opening for five minutes of the fake clock, as the database does.
    vi.useFakeTimers({ now: new Date("2026-10-26T09:00:00Z") });
    let revision = 1;
    let openedAt: number | null = null;
    let held = 0;
    const withActor = vi.fn(async (_token, fn) =>
      fn({
        async query() {
          if (openedAt === null || Date.now() - openedAt >= 5 * 60_000) {
            openedAt = Date.now();
            held = revision;
          }
          return { rows: [pending(2, { given_name: "Ana", family_name: `Testić${held}` })], rowCount: 1 } as never;
        },
      }),
    ) as unknown as WithActor;
    const surname = async () => {
      const response = await handleFastPathRequest(post({ assignmentId: ASSIGNMENT }), deps({ withActor }));
      return ((await response.json()) as { students: { surname: string }[] }).students[0]!.surname;
    };
    expect(await surname()).toBe("Testić1");
    revision = 2;
    vi.advanceTimersByTime(4 * 60_000 + 59_000);
    expect(await surname()).toBe("Testić1");
    vi.advanceTimersByTime(1_000);
    expect(await surname()).toBe("Testić2");
  });
});
