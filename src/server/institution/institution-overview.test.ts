import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { overviewOf, readInstitutionOverview } from "./institution-overview";

// An invented institution and invented counts only.
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-ustanova-7b1d";

type Row = Record<string, unknown>;

function row(extra: Row = {}): Row {
  return {
    institution_name: "Fakultet A (test)",
    confirmed_teachers: 4,
    teacher_candidates: 2,
    teachers_without_affiliation: 1,
    courses: 3,
    students: 27,
    ...extra,
  };
}

const OVERVIEW = {
  institutionName: "Fakultet A (test)",
  confirmedTeachers: 4,
  teacherCandidates: 2,
  teachersWithoutAffiliation: 1,
  courses: 3,
  students: 27,
};

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

describe("readInstitutionOverview", () => {
  it.each([undefined, "", "kratko", `${"T".repeat(42)}!`])("refuses token %j without a query", async (token) => {
    const db = database({ rows: [row()] });
    expect(await readInstitutionOverview(token, db.withActor)).toEqual({ kind: "unauthorized" });
    expect(db.withActor).not.toHaveBeenCalled();
  });

  it("reads the one row under the caller's session, with no parameter", async () => {
    const db = database({ rows: [row()] });
    expect(await readInstitutionOverview(TOKEN, db.withActor)).toEqual({ kind: "ok", overview: OVERVIEW });
    expect(db.withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatch(/FROM institution\.institution_overview\(\)\s*$/);
    expect(db.calls[0]).not.toMatch(/\$1/);
  });

  it("maps ZD401 to unauthorized and ZD403 to notFound", async () => {
    expect(await readInstitutionOverview(TOKEN, database({ code: "ZD401" }).withActor)).toEqual({ kind: "unauthorized" });
    expect(await readInstitutionOverview(TOKEN, database({ code: "ZD403" }).withActor)).toEqual({ kind: "notFound" });
  });

  it("turns any other failure into unavailable and logs only the code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readInstitutionOverview(TOKEN, database({ code: "57014" }).withActor)).toEqual({ kind: "unavailable" });
    const thrower = vi.fn(async () => { throw new Error(`do not leak ${CANARY}`); }) as unknown as WithActor;
    expect(await readInstitutionOverview(TOKEN, thrower)).toEqual({ kind: "unavailable" });
    expect(log.mock.calls).toEqual([
      ["institution overview read failed", "57014"],
      ["institution overview read failed", "unknown"],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
  });

  it.each([
    ["no row", []],
    ["two rows", [row(), row()]],
    ["a negative count", [row({ students: -1 })]],
    ["a fractional count", [row({ courses: 1.5 })]],
    ["a count as text", [row({ confirmed_teachers: "4" })]],
    ["a missing count", [row({ teacher_candidates: null })]],
    ["more unaffiliated than teachers", [row({ teachers_without_affiliation: 5 })]],
    ["an empty name", [row({ institution_name: "" })]],
    ["a name with a control character", [row({ institution_name: "Fakultet\nA" })]],
    ["a name over 200 characters", [row({ institution_name: "\u{1D49C}".repeat(201) })]],
  ])("is unavailable, never zeros, for %s", async (_label, rows) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readInstitutionOverview(TOKEN, database({ rows: rows as Row[] }).withActor)).toEqual({ kind: "unavailable" });
    expect(log).toHaveBeenCalledWith("institution overview read failed", "row_malformed");
  });
});

describe("overviewOf", () => {
  it("accepts an institution without a display name", () => {
    expect(overviewOf([row({ institution_name: null })])).toEqual({ ...OVERVIEW, institutionName: null });
  });

  // The database rule (is_plain_label) accepts edge spaces and counts characters.
  it.each([
    ["a padded name", " Fakultet A "],
    ["200 characters outside the BMP", "\u{1D49C}".repeat(200)],
  ])("accepts %s that the database constraint accepts", (_label, name) => {
    expect(overviewOf([row({ institution_name: name })])).toEqual({ ...OVERVIEW, institutionName: name });
  });

  it("accepts all zeros as a real answer", () => {
    expect(overviewOf([row({ confirmed_teachers: 0, teacher_candidates: 0, teachers_without_affiliation: 0,
      courses: 0, students: 0 })])).toEqual({ ...OVERVIEW, confirmedTeachers: 0, teacherCandidates: 0,
      teachersWithoutAffiliation: 0, courses: 0, students: 0 });
  });
});
