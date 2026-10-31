import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { namedStudentOf, readCourseStudents } from "./course-students";

// Invented ids and names only (DAN-344 R-2, contract on #923).
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-studenti-41c9";
const K1 = "00000000-0000-4000-8000-0000000000c1";
const ANA = "00000000-0000-4000-8000-000000000104";
const DORA = "00000000-0000-4000-8000-000000000105";

type Row = Record<string, unknown>;
const named = (student: string, given: unknown = "Iskra", family: unknown = "Prva"): Row => ({
  student_id: student, given_name: given, family_name: family,
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

afterEach(() => vi.restoreAllMocks());

describe("R-2 course students: the students of a course for its teacher", () => {
  it("asks once with the session and the course only, and keeps the database's order", async () => {
    const db = database({ rows: [named(ANA), named(DORA, null, null)] });
    expect(await readCourseStudents(TOKEN, db.withActor, K1)).toEqual({ kind: "ok", students: [
      { studentId: ANA, givenName: "Iskra", familyName: "Prva" },
      { studentId: DORA, givenName: null, familyName: null },
    ] });
    expect(db.withActor).toHaveBeenCalledTimes(1);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({ values: [K1], token: TOKEN });
    expect(db.calls[0]!.text).toMatch(/FROM app\.teacher_course_students\(\$1::uuid\)$/);
  });

  it("an empty answer is an empty list: the database gives every other caller nothing", async () => {
    expect(await readCourseStudents(TOKEN, database({ rows: [] }).withActor, K1)).toEqual({ kind: "ok", students: [] });
  });

  it.each(["", "nije-uuid", `${K1}x`, `'${K1}'`, "00000000-0000-4000-8000-00000000000g"])(
    "a malformed course (%s) is the same empty list, without asking", async (id) => {
      const db = database({ rows: [named(ANA)] });
      expect(await readCourseStudents(TOKEN, db.withActor, id)).toEqual({ kind: "ok", students: [] });
      expect(db.calls).toEqual([]);
    });

  it("an upper-case course id is that course", async () => {
    const db = database({ rows: [named(ANA)] });
    await readCourseStudents(TOKEN, db.withActor, K1.toUpperCase());
    expect(db.calls[0]?.values).toEqual([K1]);
  });

  it.each([undefined, "", "T".repeat(42), `${"T".repeat(42)}!`])("no well-formed session cookie (%s) asks nothing", async (token) => {
    const db = database({ rows: [] });
    expect(await readCourseStudents(token, db.withActor, K1)).toEqual({ kind: "unauthorized" });
    expect(db.calls).toEqual([]);
  });

  it("a session the database does not accept is unauthorized", async () => {
    expect(await readCourseStudents(TOKEN, database({ code: "ZD401" }).withActor, K1)).toEqual({ kind: "unauthorized" });
  });

  it("any other failure is unavailable and logs only the SQLSTATE", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readCourseStudents(TOKEN, database({ code: "57P01" }).withActor, K1)).toEqual({ kind: "unavailable" });
    expect(await readCourseStudents(TOKEN, database({ code: `x ${CANARY}` }).withActor, K1)).toEqual({ kind: "unavailable" });
    expect(log.mock.calls).toEqual([["course students read failed", "57P01"], ["course students read failed", "unknown"]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
  });

  it.each([
    ["a student id that is not a uuid", named("ana")],
    ["an upper-case student id", named("abcdef00-0000-4000-8000-000000000104".toUpperCase())],
    ["no student id", named(null as unknown as string)],
    ["only the given name", named(ANA, "Iskra", null)],
    ["only the family name", named(ANA, null, "Prva")],
    ["an empty given name", named(ANA, "", "Prva")],
    ["an empty family name", named(ANA, "Iskra", "")],
    ["a name over 255 code points", named(ANA, "Č".repeat(256), "Prva")],
    ["a name that is not text", named(ANA, 7, "Prva")],
    ["no name pair at all", { student_id: ANA }],
  ])("a row with %s makes the whole answer unavailable, never a partial list", async (_name, row) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const read = await readCourseStudents(TOKEN, database({ rows: [named(DORA), row] }).withActor, K1);
    expect(read).toEqual({ kind: "unavailable" });
    expect(log.mock.calls).toEqual([["course students read failed", "row_malformed"]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Prva");
  });

  it("a second row for the same student is unavailable, not a guess between two names", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = [named(ANA), named(ANA, "Druga", "Osoba")];
    expect(await readCourseStudents(TOKEN, database({ rows }).withActor, K1)).toEqual({ kind: "unavailable" });
  });

  it("a name of exactly 255 code points is kept, counted as code points, not UTF-16 units", () => {
    const long = "𝒜".repeat(255);
    expect(namedStudentOf(named(ANA, long, "Prva"))).toEqual({ studentId: ANA, givenName: long, familyName: "Prva" });
  });

  it("returns exactly the student and the name pair, nothing else the row may carry", () => {
    const student = namedStudentOf({ ...named(ANA), document_id: "doc-a", body: "tekst" });
    expect(Object.keys(student ?? {}).sort()).toEqual(["familyName", "givenName", "studentId"]);
  });
});
