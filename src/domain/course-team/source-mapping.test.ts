import { describe, expect, it } from "vitest";

import {
  TEACHING_TEAM_SOURCE_FORMAT_V0,
  TEACHING_TEAM_SOURCE_MAX_ROWS,
  mapTeachingTeamSource,
  type TeachingTeamMappingContext,
} from "./source-mapping";

// Every key, identifier and name below is invented (no real person or course).
const ISSUER = "https://idp.primjer.invalid";
const context: TeachingTeamMappingContext = {
  institutionKey: "ustanova-test-1",
  issuer: ISSUER,
  courses: new Map([
    ["K-ALFA", "00000000-0000-4000-8000-0000000000c1"],
    ["K-BETA", "00000000-0000-4000-8000-0000000000c2"],
  ]),
  accounts: new Map([
    ["sint-osoba-1", "00000000-0000-4000-8000-0000000000a1"],
    ["sint-osoba-2", "00000000-0000-4000-8000-0000000000a2"],
  ]),
};
const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";
const A1 = "00000000-0000-4000-8000-0000000000a1";
const A2 = "00000000-0000-4000-8000-0000000000a2";

const holder = (courseKey: string, uniqueId: string, issuer = ISSUER) => ({ courseKey, role: "holder", issuer, uniqueId });
const groupTeacher = (courseKey: string, groupName: string, uniqueId: string) => ({
  courseKey,
  role: "group_teacher",
  groupName,
  issuer: ISSUER,
  uniqueId,
});
const source = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
  format: TEACHING_TEAM_SOURCE_FORMAT_V0,
  institutionKey: "ustanova-test-1",
  rows,
  ...extra,
});

function okResult(input: unknown) {
  const result = mapTeachingTeamSource(input, context);
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result;
}

describe("mapTeachingTeamSource (M2.7-P05)", () => {
  it("R1: every candidate needs confirmation and nothing else is produced", () => {
    const result = okResult(source([holder("K-ALFA", "sint-osoba-1"), groupTeacher("K-ALFA", "Grupa 1", "sint-osoba-2")]));
    expect(result.candidates).toEqual([
      { kind: "course_holder", courseId: C1, accountId: A1, confirmation: "required" },
      { kind: "group_teacher", courseId: C1, groupName: "Grupa 1", accountId: A2, confirmation: "required" },
    ]);
    expect(result.issues).toEqual([]);
  });

  it.each([
    ["unknown top-level field", source([], { teacherName: "x" })],
    ["missing rows", { format: TEACHING_TEAM_SOURCE_FORMAT_V0, institutionKey: "ustanova-test-1" }],
    ["other format", source([], { format: "ductus-teaching-team-source-v1" })],
    ["rows not an array", source([], { rows: {} })],
    ["unknown row field (a name)", source([{ ...holder("K-ALFA", "sint-osoba-1"), displayName: "Ime Prezime" }])],
    ["missing uniqueId", source([{ courseKey: "K-ALFA", role: "holder", issuer: ISSUER }])],
    ["unknown role", source([{ ...holder("K-ALFA", "sint-osoba-1"), role: "assistant" }])],
    ["number instead of string", source([{ ...holder("K-ALFA", "sint-osoba-1"), uniqueId: 7 }])],
    ["empty course key", source([holder("", "sint-osoba-1")])],
    ["row is an array", source([["K-ALFA", "holder"]])],
    ["not a plain object", Object.assign(Object.create({ inherited: 1 }) as object, source([]))],
  ])("R1: rejects the whole input on %s", (_label, input) => {
    expect(mapTeachingTeamSource(input, context)).toEqual({ ok: false, reason: "invalid_input" });
  });

  it("R1: rejects a getter instead of a data field", () => {
    const row = holder("K-ALFA", "sint-osoba-1");
    Object.defineProperty(row, "uniqueId", { get: () => "sint-osoba-1", enumerable: true });
    expect(mapTeachingTeamSource(source([row]), context)).toEqual({ ok: false, reason: "invalid_input" });
  });

  it("R1: rejects a getter as an element of rows without running it", () => {
    let calls = 0;
    const rows: unknown[] = [];
    Object.defineProperty(rows, 0, {
      get: () => {
        calls += 1;
        return holder("K-ALFA", "sint-osoba-1");
      },
      enumerable: true,
    });
    expect(mapTeachingTeamSource(source(rows), context)).toEqual({ ok: false, reason: "invalid_input" });
    expect(calls).toBe(0);
  });

  it("R1: the row bound does not depend on an own iterator, which is never called", () => {
    let calls = 0;
    const rows: unknown[] = [holder("K-ALFA", "sint-osoba-1")];
    Object.defineProperty(rows, Symbol.iterator, {
      value: function* () {
        calls += 1;
        for (let i = 0; i <= TEACHING_TEAM_SOURCE_MAX_ROWS; i += 1) yield holder("K-ALFA", "sint-osoba-1");
      },
    });
    expect(mapTeachingTeamSource(source(rows), context)).toEqual({ ok: false, reason: "invalid_input" });
    expect(calls).toBe(0);
  });

  it("R1: one bad row rejects everything, no partial result", () => {
    const input = source([holder("K-ALFA", "sint-osoba-1"), { courseKey: "K-BETA" }]);
    expect(mapTeachingTeamSource(input, context)).toEqual({ ok: false, reason: "invalid_input" });
  });

  it("R1: rejects another institution and too many rows", () => {
    expect(mapTeachingTeamSource(source([], { institutionKey: "ustanova-test-2" }), context)).toEqual({
      ok: false,
      reason: "wrong_institution",
    });
    const rows = Array.from({ length: TEACHING_TEAM_SOURCE_MAX_ROWS + 1 }, () => holder("K-ALFA", "sint-osoba-1"));
    expect(mapTeachingTeamSource(source(rows), context)).toEqual({ ok: false, reason: "too_many_rows" });
    expect(okResult(source(rows.slice(1))).candidates).toHaveLength(1);
  });

  it("R2: matches only the exact identifier, no case folding or trimming", () => {
    const result = okResult(
      source([holder("K-ALFA", "SINT-OSOBA-1"), holder("K-BETA", " sint-osoba-1"), groupTeacher("K-BETA", "G", "sint-osoba-1 ")]),
    );
    expect(result.candidates).toEqual([]);
    expect(result.issues.map((i) => i.code)).toEqual(["unknown_account", "unknown_account", "unknown_account"]);
  });

  it("R3: the same uniqueId under another issuer gives no candidate (D-104)", () => {
    const result = okResult(source([holder("K-ALFA", "sint-osoba-1", "https://drugi.primjer.invalid")]));
    expect(result.candidates).toEqual([]);
    expect(result.issues).toEqual([{ row: 0, code: "foreign_issuer" }]);
  });

  it("R4: an unknown course or account is an issue, never a candidate", () => {
    const result = okResult(source([holder("K-GAMA", "sint-osoba-1"), groupTeacher("K-ALFA", "Grupa 1", "sint-osoba-9")]));
    expect(result.candidates).toEqual([]);
    expect(result.issues).toEqual([
      { row: 0, code: "unknown_course" },
      { row: 1, code: "unknown_account" },
    ]);
  });

  it("R5: two different holders of one course give no holder candidate", () => {
    const result = okResult(
      source([holder("K-ALFA", "sint-osoba-1"), holder("K-ALFA", "sint-osoba-2"), holder("K-BETA", "sint-osoba-2")]),
    );
    expect(result.candidates).toEqual([{ kind: "course_holder", courseId: C2, accountId: A2, confirmation: "required" }]);
    expect(result.issues).toEqual([
      { row: 0, code: "holder_conflict" },
      { row: 1, code: "holder_conflict" },
    ]);
  });

  it.each([
    ["an unknown account", holder("K-ALFA", "sint-osoba-9"), "unknown_account"],
    ["a foreign issuer", holder("K-ALFA", "sint-osoba-1", "https://drugi.primjer.invalid"), "foreign_issuer"],
  ] as const)("R5: a second holder with %s is still a conflict, in either order", (_label, other, code) => {
    const known = holder("K-ALFA", "sint-osoba-1");
    const issues = (otherRow: number) =>
      [
        { row: 1 - otherRow, code: "holder_conflict" },
        { row: otherRow, code },
        { row: otherRow, code: "holder_conflict" },
      ].sort((a, b) => a.row - b.row || (a.code < b.code ? -1 : 1));
    expect(okResult(source([known, other]))).toEqual({ ok: true, candidates: [], issues: issues(1) });
    expect(okResult(source([other, known]))).toEqual({ ok: true, candidates: [], issues: issues(0) });
  });

  it("R6: a repeated row gives one candidate and a duplicate issue", () => {
    const result = okResult(
      source([holder("K-ALFA", "sint-osoba-1"), holder("K-ALFA", "sint-osoba-1"), groupTeacher("K-ALFA", "G", "sint-osoba-2"), groupTeacher("K-ALFA", "G", "sint-osoba-2")]),
    );
    expect(result.candidates).toHaveLength(2);
    expect(result.issues).toEqual([
      { row: 1, code: "duplicate" },
      { row: 3, code: "duplicate" },
    ]);
  });

  it("R6: the same teacher in two groups gives two candidates", () => {
    const result = okResult(source([groupTeacher("K-ALFA", "G1", "sint-osoba-1"), groupTeacher("K-ALFA", "G2", "sint-osoba-1")]));
    expect(result.candidates.map((c) => (c.kind === "group_teacher" ? c.groupName : ""))).toEqual(["G1", "G2"]);
  });

  it.each([
    ["holder with a group", { ...holder("K-ALFA", "sint-osoba-1"), groupName: "G" }],
    ["group teacher without a group", { ...groupTeacher("K-ALFA", "G", "sint-osoba-1"), groupName: undefined }],
    ["empty name", groupTeacher("K-ALFA", "", "sint-osoba-1")],
    ["outer spaces", groupTeacher("K-ALFA", " G ", "sint-osoba-1")],
    ["control character", groupTeacher("K-ALFA", "G\u0007", "sint-osoba-1")],
    ["line separator", groupTeacher("K-ALFA", "G\u2028H", "sint-osoba-1")],
    ["not NFC", groupTeacher("K-ALFA", "C\u030C", "sint-osoba-1")],
    ["too long", groupTeacher("K-ALFA", "g".repeat(121), "sint-osoba-1")],
  ])("R7: %s is an invalid group name", (_label, row) => {
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    const result = okResult(source([clean]));
    expect(result.candidates).toEqual([]);
    expect(result.issues).toEqual([{ row: 0, code: "invalid_group_name" }]);
  });

  it("R7: accepts a 120-character NFC name", () => {
    expect(okResult(source([groupTeacher("K-ALFA", "Č".repeat(120), "sint-osoba-1")])).candidates).toHaveLength(1);
  });

  it("R8: the candidates and issue codes do not depend on row order, and the input is not changed", () => {
    const rows = [
      holder("K-BETA", "sint-osoba-2"),
      groupTeacher("K-ALFA", "G2", "sint-osoba-1"),
      holder("K-ALFA", "sint-osoba-1"),
      groupTeacher("K-ALFA", "G1", "sint-osoba-2"),
      holder("K-ALFA", "sint-osoba-1"),
      holder("K-GAMA", "sint-osoba-1"),
    ];
    const snapshot = JSON.stringify(rows);
    const forward = okResult(source(rows));
    const backward = okResult(source([...rows].reverse()));
    expect(backward.candidates).toEqual(forward.candidates);
    expect(backward.issues.map((i) => i.code).sort()).toEqual(forward.issues.map((i) => i.code).sort());
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(forward.candidates.map((c) => c.kind)).toEqual(["course_holder", "group_teacher", "group_teacher", "course_holder"]);
  });
});
