import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { itemsOf, readStudentWorkspace } from "./student-workspace";

// Invented courses, assignments and documents only.
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-radovi-3c9e";
const K1 = "00000000-0000-4000-8000-0000000000c1";
const K2 = "00000000-0000-4000-8000-0000000000c2";
const Z1 = "00000000-0000-4000-8000-0000000000a1";
const Z2 = "00000000-0000-4000-8000-0000000000a2";
const Z3 = "00000000-0000-4000-8000-0000000000a3";

type Row = Record<string, unknown>;

function row(id: string, extra: Row = {}): Row {
  return {
    assignment_id: id,
    course_id: K1,
    course_name: "Čitanje izvora",
    academic_year: "2026/2027",
    title: "Esej",
    opens_at: new Date("2026-11-02T07:00:00Z"),
    due_at: new Date("2026-11-20T22:00:00Z"),
    current_version: 1,
    acknowledged: false,
    document_id: null,
    server_revision: null,
    submitted_revision: null,
    submitted_at: null,
    after_deadline: null,
    ...extra,
  };
}

const WORK = { document_id: "doc-a", server_revision: "3" };
const SUBMITTED = { ...WORK, submitted_revision: "2", submitted_at: new Date("2026-11-19T10:00:00Z"), after_deadline: false };

function database(answer: { rows?: Row[]; code?: string }) {
  const calls: string[] = [];
  const withActor = vi.fn(async (_token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string) {
        calls.push(text);
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("readStudentWorkspace", () => {
  it.each([undefined, "", "kratko", `${"T".repeat(42)}!`])("refuses token %j without a query", async (token) => {
    const db = database({ rows: [row(Z1)] });
    expect(await readStudentWorkspace(token, db.withActor)).toEqual({ kind: "unauthorized" });
    expect(db.withActor).not.toHaveBeenCalled();
  });

  it("asks only the authorised function, with the session token", async () => {
    const db = database({ rows: [] });
    expect(await readStudentWorkspace(TOKEN, db.withActor)).toEqual({ kind: "ok", items: [] });
    expect(db.withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatch(/FROM app\.student_workspace\(\)\s*$/);
    expect(db.calls[0]).not.toMatch(/\b(evidence|institution)\./);
  });

  it("maps a session the database does not accept to unauthorized", async () => {
    const db = database({ code: "ZD401" });
    expect(await readStudentWorkspace(TOKEN, db.withActor)).toEqual({ kind: "unauthorized" });
  });

  it.each(["42501", "57014", undefined])("maps database failure %j to unavailable, never an empty list", async (code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = database({ code: code ?? "" });
    if (code === undefined) {
      db.withActor = vi.fn(async () => { throw new Error(`do not leak ${CANARY}`); }) as unknown as WithActor;
    }
    expect(await readStudentWorkspace(TOKEN, db.withActor)).toEqual({ kind: "unavailable" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
    expect(log).toHaveBeenCalledWith("student workspace read failed", code ?? "unknown");
  });

  it("maps a malformed row to unavailable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = database({ rows: [row("Z1")] });
    expect(await readStudentWorkspace(TOKEN, db.withActor)).toEqual({ kind: "unavailable" });
    expect(log).toHaveBeenCalledWith("student workspace read failed", "row_malformed");
  });

  it("returns the caller's own work and submission", async () => {
    const db = database({ rows: [row(Z1, { acknowledged: true, ...SUBMITTED })] });
    expect(await readStudentWorkspace(TOKEN, db.withActor)).toEqual({
      kind: "ok",
      items: [{
        assignmentId: Z1, courseId: K1, courseName: "Čitanje izvora", academicYear: "2026/2027", title: "Esej",
        opensAt: "2026-11-02T07:00:00.000Z", dueAt: "2026-11-20T22:00:00.000Z", currentVersion: 1, acknowledged: true,
        documentId: "doc-a", serverRevision: 3, submittedRevision: 2, submittedAt: "2026-11-19T10:00:00.000Z",
        afterDeadline: false,
      }],
    });
  });
});

describe("itemsOf", () => {
  it("accepts an assignment with no work yet and one with work but no submission", () => {
    const items = itemsOf([row(Z1), row(Z2, WORK)]);
    expect(items?.map((i) => [i.documentId, i.serverRevision, i.submittedRevision])).toEqual([
      [null, null, null], ["doc-a", 3, null],
    ]);
  });

  it.each<[string, Row]>([
    ["an upper-case uuid", { assignment_id: Z1.toUpperCase() }],
    ["a malformed course id", { course_id: "k1" }],
    ["an empty course name", { course_name: "" }],
    ["a malformed academic year", { academic_year: "2026-27" }],
    ["an empty title", { title: "" }],
    ["a date as text", { due_at: "2026-11-20T22:00:00Z" }],
    ["an invalid date", { opens_at: new Date(NaN) }],
    ["a version of zero", { current_version: 0 }],
    ["a fractional version", { current_version: 1.5 }],
    ["acknowledged as text", { acknowledged: "true" }],
    ["a document id with a control character", { document_id: "doc\u0000a", server_revision: "0" }],
    ["a padded document id", { document_id: " doc-a", server_revision: "0" }],
    ["a document id over 256 characters", { document_id: "d".repeat(257), server_revision: "0" }],
    ["a revision without a document", { server_revision: "0" }],
    ["a document without a revision", { document_id: "doc-a" }],
    ["a negative revision", { ...WORK, server_revision: "-1" }],
    ["a revision with a leading zero", { ...WORK, server_revision: "01" }],
    ["a revision as a number", { ...WORK, server_revision: 3 }],
    ["a revision past the safe range", { ...WORK, server_revision: "9007199254740993" }],
    ["a submission past the server revision", { ...SUBMITTED, submitted_revision: "4" }],
    ["a submission without a document", { ...SUBMITTED, document_id: null, server_revision: null }],
    ["a submission without its time", { ...SUBMITTED, submitted_at: null }],
    ["a submission without its deadline flag", { ...SUBMITTED, after_deadline: null }],
    ["a submission time alone", { ...WORK, submitted_at: new Date("2026-11-19T10:00:00Z") }],
  ])("refuses the whole list for %s", (_name, extra) => {
    expect(itemsOf([row(Z2), row(Z1, extra)])).toBeNull();
  });

  it("refuses two rows for one assignment, never choosing one", () => {
    expect(itemsOf([row(Z1, WORK), row(Z1, { document_id: "doc-a2", server_revision: "0" })])).toBeNull();
  });

  it("refuses one course with two names or years", () => {
    expect(itemsOf([row(Z1), row(Z2, { course_name: "Drugo ime" })])).toBeNull();
    expect(itemsOf([row(Z1), row(Z2, { academic_year: "2025/2026" })])).toBeNull();
  });

  it("orders by due time, course, title and id, whatever the row order", () => {
    const rows = [
      row(Z3, { course_id: K2, course_name: "Akademsko pisanje", title: "Bilješke" }),
      row(Z2, { title: "Analiza" }),
      row(Z1, { due_at: new Date("2026-11-30T22:00:00Z") }),
      row("00000000-0000-4000-8000-0000000000a0", { title: "Analiza" }),
    ];
    const ids = (input: Row[]) => itemsOf(input)?.map((i) => i.assignmentId);
    const expected = [Z3, "00000000-0000-4000-8000-0000000000a0", Z2, Z1];
    expect(ids(rows)).toEqual(expected);
    expect(ids([...rows].reverse())).toEqual(expected);
  });

  it("collates Croatian letters in course names", () => {
    const items = itemsOf([
      row(Z1, { course_id: K1, course_name: "Čitanje" }),
      row(Z2, { course_id: K2, course_name: "Dijalog" }),
      row(Z3, { course_id: "00000000-0000-4000-8000-0000000000c3", course_name: "Cilj" }),
    ]);
    expect(items?.map((i) => i.courseName)).toEqual(["Cilj", "Čitanje", "Dijalog"]);
  });
});
