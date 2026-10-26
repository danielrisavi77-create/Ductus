import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import {
  handleAssignmentSubmissionsRequest, readAssignmentSubmissions, readAssignmentSubmissionsMany, submissionOf,
} from "./assignment-submissions";

// Invented ids only (DAN-332, contract on #826).
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-predaje-7e21";
const Z1 = "00000000-0000-4000-8000-0000000000a1";
const Z2 = "00000000-0000-4000-8000-0000000000a2";
const ANA = "00000000-0000-4000-8000-000000000104";
const BORIS = "00000000-0000-4000-8000-000000000105";
const CVITA = "00000000-0000-4000-8000-000000000106";
const MINUTE = new Date("2026-11-02T13:32:00.000Z");

type Row = Record<string, unknown>;
const submitted = (student: string, more: Row = {}): Row => ({
  assignment_id: Z1, student_id: student, document_id: `doc-${student.slice(-3)}`, submitted: true,
  revision: "12", requested_minute: MINUTE, after_deadline: false, ...more,
});
const open = (student: string, document: string | null): Row => ({
  assignment_id: Z1, student_id: student, document_id: document, submitted: false,
  revision: null, requested_minute: null, after_deadline: null,
});

function database(answer: { rows?: Row[]; code?: string }) {
  const calls: { text: string; values: unknown[] | undefined; token: string | null | undefined }[] = [];
  const withActor = vi.fn(async (token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values, token });
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction),
  ) as unknown as WithActor;
  return { withActor, calls };
}

const get = (headers: Record<string, string> = {}, method = "GET") =>
  new Request(`https://ductus.example/api/teacher/assignments/${Z1}/submissions`, { method, headers });

afterEach(() => vi.restoreAllMocks());

describe("R1 read: the submissions of an assignment for its teacher (N13, N6)", () => {
  it("asks once with the session and the assignment only, and answers the rows in order", async () => {
    const db = database({ rows: [
      submitted(ANA), submitted(BORIS, { after_deadline: true, revision: "3" }), open(CVITA, null),
    ] });
    expect(await readAssignmentSubmissions(TOKEN, Z1, db.withActor)).toEqual({ kind: "ok", submissions: [
      { studentId: ANA, documentId: "doc-104", submitted: true, revision: 12, requestedMinute: "2026-11-02T13:32:00.000Z", afterDeadline: false },
      { studentId: BORIS, documentId: "doc-105", submitted: true, revision: 3, requestedMinute: "2026-11-02T13:32:00.000Z", afterDeadline: true },
      { studentId: CVITA, documentId: null, submitted: false, revision: null, requestedMinute: null, afterDeadline: null },
    ] });
    expect(db.withActor).toHaveBeenCalledTimes(1);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({ values: [[Z1]], token: TOKEN });
    expect(db.calls[0]!.text).toMatch(/FROM app\.assignment_submissions\(a\.id\) s\s+LEFT JOIN app\.assignment_works\(a\.id\) w ON w\.student_id = s\.student_id/);
  });

  it("a work without a submission is not submitted, with the three fields null", () => {
    expect(submissionOf(open(BORIS, "doc-b"))).toEqual({
      studentId: BORIS, documentId: "doc-b", submitted: false, revision: null, requestedMinute: null, afterDeadline: null,
    });
  });

  it("an empty answer is an empty list: the database gives every other caller nothing (N1-N5, N7)", async () => {
    expect(await readAssignmentSubmissions(TOKEN, Z1, database({ rows: [] }).withActor)).toEqual({ kind: "ok", submissions: [] });
  });

  it.each(["", "nije-uuid", `${Z1}x`, `'${Z1}'`, "00000000-0000-4000-8000-00000000000g"])(
    "a malformed assignment (%s) is the same empty list, without asking (N7)", async (id) => {
      const db = database({ rows: [submitted(ANA)] });
      expect(await readAssignmentSubmissions(TOKEN, id, db.withActor)).toEqual({ kind: "ok", submissions: [] });
      expect(db.calls).toEqual([]);
    });

  it("an upper-case assignment id is that assignment (N7)", async () => {
    const db = database({ rows: [submitted(ANA)] });
    const read = await readAssignmentSubmissions(TOKEN, Z1.toUpperCase(), db.withActor);
    expect(read.kind === "ok" ? read.submissions.map((s) => s.studentId) : null).toEqual([ANA]);
    expect(db.calls[0]?.values).toEqual([[Z1]]);
  });

  it.each([undefined, "", "T".repeat(42), `${"T".repeat(42)}!`])("no well-formed session cookie (%s) asks nothing (N8)", async (token) => {
    const db = database({ rows: [] });
    expect(await readAssignmentSubmissions(token, Z1, db.withActor)).toEqual({ kind: "unauthorized" });
    expect(db.calls).toEqual([]);
  });

  it("a session the database does not accept is unauthorized (N8)", async () => {
    expect(await readAssignmentSubmissions(TOKEN, Z1, database({ code: "ZD401" }).withActor)).toEqual({ kind: "unauthorized" });
  });

  it("any other failure is unavailable and logs only the SQLSTATE (N10)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readAssignmentSubmissions(TOKEN, Z1, database({ code: "57P01" }).withActor)).toEqual({ kind: "unavailable" });
    expect(await readAssignmentSubmissions(TOKEN, Z1, database({ code: `x ${CANARY}` }).withActor)).toEqual({ kind: "unavailable" });
    expect(log.mock.calls).toEqual([["assignment submissions read failed", "57P01"], ["assignment submissions read failed", "unknown"]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
  });

  it.each([
    ["a student id that is not a uuid", submitted("ana")],
    ["a document id with a control character", submitted(ANA, { document_id: "doc\na" })],
    ["a document id with outer blanks", submitted(ANA, { document_id: " doc" })],
    ["submitted that is not a boolean", submitted(ANA, { submitted: "true" })],
    ["submitted without a revision", submitted(ANA, { revision: null })],
    ["submitted without a minute", submitted(ANA, { requested_minute: null })],
    ["submitted without the deadline mark", submitted(ANA, { after_deadline: null })],
    ["a revision as a number, not int8 text", submitted(ANA, { revision: 12 })],
    ["a negative revision", submitted(ANA, { revision: "-1" })],
    ["a revision over the safe integers", submitted(ANA, { revision: "9007199254740993" })],
    ["a minute with seconds", submitted(ANA, { requested_minute: new Date("2026-11-02T13:32:07.000Z") })],
    ["a minute with milliseconds", submitted(ANA, { requested_minute: new Date("2026-11-02T13:32:00.001Z") })],
    ["a minute that is not a time", submitted(ANA, { requested_minute: new Date(Number.NaN) })],
    ["a minute as text", submitted(ANA, { requested_minute: "2026-11-02T13:32:00.000Z" })],
    ["not submitted with a revision", { ...open(ANA, "doc-a"), revision: "1" }],
    ["not submitted with a minute", { ...open(ANA, "doc-a"), requested_minute: MINUTE }],
    ["not submitted with a deadline mark", { ...open(ANA, "doc-a"), after_deadline: false }],
    ["an assignment that was not asked", submitted(ANA, { assignment_id: Z2 })],
  ])("a row with %s makes the whole answer unavailable, never 'not submitted' (N10)", async (_name, row) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const read = await readAssignmentSubmissions(TOKEN, Z1, database({ rows: [open(BORIS, "doc-b"), row] }).withActor);
    expect(read).toEqual({ kind: "unavailable" });
    expect(log.mock.calls).toEqual([["assignment submissions read failed", "row_malformed"]]);
  });

  it("a second row for the same student is unavailable, not a guess between two works (N10)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = [submitted(ANA), submitted(ANA, { document_id: "doc-other" })];
    expect(await readAssignmentSubmissions(TOKEN, Z1, database({ rows }).withActor)).toEqual({ kind: "unavailable" });
  });

  it("the largest safe revision is kept exactly", () => {
    expect(submissionOf(submitted(ANA, { revision: "9007199254740991" }))?.revision).toBe(9007199254740991);
  });
});

describe("R1 read of many assignments in one statement", () => {
  it("asks once with every well-formed id once and groups the rows by assignment", async () => {
    const db = database({ rows: [submitted(ANA), submitted(ANA, { assignment_id: Z2, after_deadline: true })] });
    const read = await readAssignmentSubmissionsMany(TOKEN, [Z1, Z2, Z1.toUpperCase(), "z-1"], db.withActor);
    expect(read.kind === "ok" ? Object.fromEntries([...read.submissions].map(([id, list]) => [id, list.map((s) => s.afterDeadline)])) : null)
      .toEqual({ [Z1]: [false], [Z2]: [true] });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.values).toEqual([[Z1, Z2]]);
  });

  it("does not touch the database without a session or without a well-formed assignment", async () => {
    const db = database({ rows: [] });
    expect(await readAssignmentSubmissionsMany(undefined, [Z1], db.withActor)).toEqual({ kind: "unauthorized" });
    const none = await readAssignmentSubmissionsMany(TOKEN, ["z-1"], db.withActor);
    expect(none.kind === "ok" ? none.submissions.size : -1).toBe(0);
    expect(db.calls).toEqual([]);
  });
});

describe("R1 route: GET /api/teacher/assignments/[assignmentId]/submissions", () => {
  it("answers the teacher's rows with no-store and exactly the six fields (N11, N13)", async () => {
    const db = database({ rows: [submitted(ANA), open(CVITA, null)] });
    const response = await handleAssignmentSubmissionsRequest(get({ "sec-fetch-site": "same-origin" }), Z1, { withActor: db.withActor, sessionToken: TOKEN });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { submissions: Record<string, unknown>[] };
    expect(Object.keys(body)).toEqual(["submissions"]);
    for (const row of body.submissions) {
      expect(Object.keys(row).sort()).toEqual(["afterDeadline", "documentId", "requestedMinute", "revision", "studentId", "submitted"]);
    }
    expect(body.submissions[0]).toMatchObject({ requestedMinute: "2026-11-02T13:32:00.000Z", revision: 12 });
  });

  it("a refused caller and a missing assignment read the same empty list (N1-N5, N7)", async () => {
    for (const id of [Z1, "nije-uuid"]) {
      const response = await handleAssignmentSubmissionsRequest(get(), id, { withActor: database({ rows: [] }).withActor, sessionToken: TOKEN });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ submissions: [] });
    }
  });

  it("no session is 401 without asking; a session the database refuses is 401 (N8)", async () => {
    const db = database({ rows: [] });
    for (const sessionToken of [undefined, "kratko"]) {
      const response = await handleAssignmentSubmissionsRequest(get(), Z1, { withActor: db.withActor, sessionToken });
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    expect(db.calls).toEqual([]);
    const refused = await handleAssignmentSubmissionsRequest(get(), Z1, { withActor: database({ code: "ZD401" }).withActor, sessionToken: TOKEN });
    expect(refused.status).toBe(401);
  });

  it.each(["cross-site", "same-site", "none"])("Sec-Fetch-Site %s is 403 before the database (N9)", async (site) => {
    const db = database({ rows: [submitted(ANA)] });
    const response = await handleAssignmentSubmissionsRequest(get({ "sec-fetch-site": site }), Z1, { withActor: db.withActor, sessionToken: TOKEN });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(db.calls).toEqual([]);
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])("%s is 405 before the database (N9)", async (method) => {
    const db = database({ rows: [] });
    const response = await handleAssignmentSubmissionsRequest(get({}, method), Z1, { withActor: db.withActor, sessionToken: TOKEN });
    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(db.calls).toEqual([]);
  });

  it("a failure or a row it cannot vouch for is 503 unavailable with no detail (N10)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const answer of [{ code: `x ${CANARY}` }, { rows: [submitted(ANA, { revision: null })] }]) {
      const response = await handleAssignmentSubmissionsRequest(get(), Z1, { withActor: database(answer).withActor, sessionToken: TOKEN });
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = await response.text();
      expect(text).toBe(JSON.stringify({ error: "unavailable" }));
    }
  });
});
