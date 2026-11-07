import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import {
  academicYearsOf,
  institutionCoursesOf,
  isAcademicYear,
  readAcademicYears,
  readInstitutionCourses,
} from "./institution-courses";

// Invented courses, groups, people and ids only.
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-kolegiji-7d1a";
const YEAR = "2026/2027";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

type Row = Record<string, unknown>;

const EMPTY: Row = { kind: null, course_id: null, course_name: null, group_id: null, group_name: null, user_id: null,
  given_name: null, family_name: null, students: null };
const course = (c: number, name: string, students: unknown, extra: Row = {}): Row =>
  ({ ...EMPTY, kind: "course", course_id: id(c), course_name: name, students, ...extra });
const group = (c: number, g: number, name: string, students: unknown, extra: Row = {}): Row =>
  ({ ...EMPTY, kind: "group", course_id: id(c), group_id: id(g), group_name: name, students, ...extra });
const person = (kind: string, c: number, u: number, name: [string, string] | null = ["Ana", "Uzorak"], extra: Row = {}): Row =>
  ({ ...EMPTY, kind, course_id: id(c), user_id: id(u), given_name: name?.[0] ?? null, family_name: name?.[1] ?? null,
    ...extra });
const groupTeacher = (c: number, g: number, u: number, name: [string, string] | null = ["Ana", "Uzorak"]): Row =>
  ({ ...person("group_teacher", c, u, name), group_id: id(g) });

/** One course with a holder, two team members, two groups and a group teacher. */
const SAMPLE: Row[] = [
  course(1, "Uvod u primjere", 3),
  person("holder", 1, 10, ["Ana", "Uzorak"]),
  person("team", 1, 10, ["Ana", "Uzorak"]),
  person("team", 1, 11, null),
  group(1, 20, "Grupa B", 1),
  group(1, 21, "Grupa A", 2),
  groupTeacher(1, 21, 11, null),
];

function database(answer: { rows?: Row[]; code?: string }) {
  const calls: { text: string; values?: readonly unknown[] }[] = [];
  const withActor = vi.fn(async (_token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string, values?: readonly unknown[]) {
        calls.push({ text, values });
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction)) as unknown as WithActor;
  return { withActor, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("isAcademicYear", () => {
  it.each(["2026/2027", "1999/2000", "0000/0001"])("accepts %j", (year) => expect(isAcademicYear(year)).toBe(true));
  it.each([undefined, null, 2026, "", "2026/2026", "2026/2028", "2027/2026", "2026-2027", "26/27", " 2026/2027",
    "2026/2027\n", "٢٠٢٦/٢٠٢٧", "9999/10000"])("refuses %j", (year) => expect(isAcademicYear(year)).toBe(false));
});

describe("readInstitutionCourses", () => {
  it.each([undefined, "", "kratko", `${"T".repeat(42)}!`])("refuses token %j without a query", async (token) => {
    const db = database({ rows: [] });
    expect(await readInstitutionCourses(token, YEAR, db.withActor)).toEqual({ kind: "unauthorized" });
    expect(db.withActor).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "2026/2028", "2026/2027; --"])("refuses year %j without a query", async (year) => {
    const db = database({ rows: [] });
    expect(await readInstitutionCourses(TOKEN, year, db.withActor)).toEqual({ kind: "invalid" });
    expect(db.withActor).not.toHaveBeenCalled();
  });

  it("reads once under the caller's session, with the year as the only parameter", async () => {
    const db = database({ rows: SAMPLE });
    expect(await readInstitutionCourses(TOKEN, YEAR, db.withActor)).toEqual({
      kind: "ok",
      academicYear: YEAR,
      courses: [{
        courseId: id(1), name: "Uvod u primjere", students: 3,
        holder: { personId: id(10), name: { givenName: "Ana", familyName: "Uzorak" } },
        team: [{ personId: id(10), name: { givenName: "Ana", familyName: "Uzorak" } }, { personId: id(11), name: null }],
        groups: [
          { groupId: id(21), name: "Grupa A", students: 2, teachers: [{ personId: id(11), name: null }] },
          { groupId: id(20), name: "Grupa B", students: 1, teachers: [] },
        ],
      }],
    });
    expect(db.withActor).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]!.text).toContain("institution.institution_courses($1)");
    expect(db.calls[0]!.values).toEqual([YEAR]);
  });

  it("answers no courses for a year without any", async () => {
    expect(await readInstitutionCourses(TOKEN, YEAR, database({ rows: [] }).withActor))
      .toEqual({ kind: "ok", academicYear: YEAR, courses: [] });
  });

  it.each([
    ["ZD401", "unauthorized"],
    ["ZD403", "notFound"],
    ["ZD422", "invalid"],
    ["42501", "unavailable"],
    ["57014", "unavailable"],
  ])("maps SQLSTATE %s to %s and logs only the code", async (code, kind) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readInstitutionCourses(TOKEN, YEAR, database({ code }).withActor)).toEqual({ kind });
    expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
    if (kind === "unavailable") expect(log).toHaveBeenCalledWith("institution courses read failed", code);
    else expect(log).not.toHaveBeenCalled();
  });

  it("logs unknown for an error without a SQLSTATE", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const withActor = vi.fn(async () => { throw new Error(CANARY); }) as unknown as WithActor;
    expect(await readInstitutionCourses(TOKEN, YEAR, withActor)).toEqual({ kind: "unavailable" });
    expect(log).toHaveBeenCalledWith("institution courses read failed", "unknown");
  });

  it("is unavailable, never a shorter list, when one row is malformed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = database({ rows: [...SAMPLE, course(2, "Drugi", -1)] });
    expect(await readInstitutionCourses(TOKEN, YEAR, db.withActor)).toEqual({ kind: "unavailable" });
    expect(log).toHaveBeenCalledWith("institution courses read failed", "row_malformed");
  });
});

describe("institutionCoursesOf", () => {
  it.each<[string, Row[]]>([
    ["an unknown kind", [course(1, "K", 0, { kind: "student" })]],
    ["a course id that is not a UUID", [course(1, "K", 0, { course_id: "1" })]],
    ["the same course twice", [course(1, "K", 0), course(1, "L", 0)]],
    ["an empty course name", [course(1, "", 0)]],
    ["a blank course name", [course(1, "   ", 0)]],
    ["a course name of 201 code points", [course(1, "Ž".repeat(201), 0)]],
    ["a course name with a control character", [course(1, "K\u0007", 0)]],
    ["a course name with a C1 control character", [course(1, "K\u0085", 0)]],
    ["a negative count", [course(1, "K", -1)]],
    ["a fractional count", [course(1, "K", 1.5)]],
    ["a count as text", [course(1, "K", "3")]],
    ["a course row with a person", [course(1, "K", 0, { user_id: id(9) })]],
    ["a course row with a name", [course(1, "K", 0, { given_name: "Ana", family_name: "Uzorak" })]],
    ["a group of an unknown course", [course(1, "K", 1), group(2, 20, "G", 0)]],
    ["the same group twice", [course(1, "K", 2), group(1, 20, "G", 0), group(1, 20, "H", 0)]],
    ["a group without a count", [course(1, "K", 1), group(1, 20, "G", null)]],
    ["a group without a name", [course(1, "K", 1), group(1, 20, "", 0)]],
    ["a group with a person", [course(1, "K", 1), group(1, 20, "G", 0, { user_id: id(9) })]],
    ["groups with more students than the course", [course(1, "K", 2), group(1, 20, "G", 2), group(1, 21, "H", 1)]],
    ["a holder of an unknown course", [course(1, "K", 0), person("holder", 2, 10)]],
    ["two holders of one course", [course(1, "K", 0), person("holder", 1, 10), person("holder", 1, 11)]],
    ["a holder without a person", [course(1, "K", 0), person("holder", 1, 10, null, { user_id: null })]],
    ["a holder with a count", [course(1, "K", 0), person("holder", 1, 10, null, { students: 1 })]],
    ["a holder with a group", [course(1, "K", 1), group(1, 20, "G", 0), person("holder", 1, 10, null, { group_id: id(20) })]],
    ["half a name", [course(1, "K", 0), person("team", 1, 10, null, { given_name: "Ana" })]],
    ["a name with a control character", [course(1, "K", 0), person("team", 1, 10, ["Ana\u0007", "Uzorak"])]],
    ["the same team member twice", [course(1, "K", 0), person("team", 1, 10), person("team", 1, 10)]],
    ["one person with two names", [course(1, "K", 0), person("holder", 1, 10, ["Ana", "Uzorak"]),
      person("team", 1, 10, ["Iva", "Primjer"])]],
    ["one person once named, once not", [course(1, "K", 0), person("holder", 1, 10), person("team", 1, 10, null)]],
    ["a group teacher of an unknown group", [course(1, "K", 0), person("team", 1, 10), groupTeacher(1, 20, 10)]],
    ["a group teacher without a group", [course(1, "K", 0), person("team", 1, 10), person("group_teacher", 1, 10)]],
    ["a group teacher under another course", [course(1, "K", 0), course(2, "L", 0), group(2, 20, "G", 0),
      person("team", 1, 10), person("team", 2, 10), groupTeacher(1, 20, 10)]],
    ["the same group teacher twice", [course(1, "K", 0), group(1, 20, "G", 0), person("team", 1, 10),
      groupTeacher(1, 20, 10), groupTeacher(1, 20, 10)]],
    ["a group teacher who is not on the team", [course(1, "K", 0), group(1, 20, "G", 0), groupTeacher(1, 20, 10)]],
  ])("refuses %s", (_label, rows) => {
    expect(institutionCoursesOf(rows)).toBeNull();
  });

  it("accepts a course name of 200 code points, counted as the database counts", () => {
    const long = "𝔸".repeat(200);
    expect(institutionCoursesOf([course(1, long, 0)])?.[0]?.name).toBe(long);
  });

  it("keeps a course without holder, team or groups", () => {
    expect(institutionCoursesOf([course(1, "K", 0)]))
      .toEqual([{ courseId: id(1), name: "K", students: 0, holder: null, team: [], groups: [] }]);
  });

  it("orders courses and groups by name in Croatian collation, then id", () => {
    const courses = institutionCoursesOf([
      course(4, "Zakon", 0), course(3, "Čitanje", 0), course(2, "Cvijeće", 0), course(1, "Čitanje", 0),
      group(2, 23, "Šarena", 0), group(2, 22, "Sunce", 0), group(2, 21, "Sunce", 0),
    ]);
    expect(courses?.map((c) => c.courseId)).toEqual([id(2), id(1), id(3), id(4)]);
    expect(courses?.[0]?.groups.map((g) => g.groupId)).toEqual([id(21), id(22), id(23)]);
  });

  it("gives the same courses, as a permutation of the rows, whatever order the rows come in", () => {
    const names = fc.option(fc.constantFrom<[string, string]>(["Ana", "Cvjetić"], ["Bor", "Čavlić"], ["Ivo", "Zorić"]),
      { nil: null });
    const shape = fc.uniqueArray(fc.record({
      c: fc.integer({ min: 1, max: 50 }),
      title: fc.constantFrom("Čitanje", "Cvijeće", "Zakon"),
      team: fc.uniqueArray(fc.integer({ min: 100, max: 120 }), { maxLength: 4 }),
      groups: fc.uniqueArray(fc.integer({ min: 0, max: 5 }), { maxLength: 3 }),
      holder: fc.boolean(),
    }), { selector: (r) => r.c, maxLength: 6 });
    type Shape = { c: number; title: string; team: number[]; groups: number[]; holder: boolean };
    const rowsOf = (list: Shape[],
      nameOfUser: (u: number) => [string, string] | null) => list.flatMap(({ c, title, team, groups, holder }) => [
      course(c, title, groups.length),
      ...(holder && team[0] !== undefined ? [person("holder", c, team[0], nameOfUser(team[0]))] : []),
      ...team.map((u) => person("team", c, u, nameOfUser(u))),
      ...groups.flatMap((g) => [group(c, 1000 + c * 10 + g, `Grupa ${g}`, 1),
        ...team.slice(0, g % 3).map((u) => groupTeacher(c, 1000 + c * 10 + g, u, nameOfUser(u)))]),
    ]);
    fc.assert(fc.property(shape, fc.func(names), fc.func(fc.integer()), (list, nameFn, key) => {
      const input = rowsOf(list, (u) => nameFn(u));
      const shuffled = input.map((r, i) => ({ r, k: key(i) })).sort((a, b) => a.k - b.k).map((x) => x.r);
      const first = institutionCoursesOf(input);
      expect(first).not.toBeNull();
      expect(institutionCoursesOf(shuffled)).toEqual(first);
      expect(first!.map((c) => c.courseId).sort()).toEqual(list.map((l) => id(l.c)).sort());
      const people = first!.flatMap((c) => [...c.team, ...c.groups.flatMap((g) => g.teachers)]).length;
      expect(people).toBe(input.filter((r) => r.kind === "team" || r.kind === "group_teacher").length);
    }));
  });
});

describe("readAcademicYears", () => {
  it.each([undefined, "", `${"T".repeat(42)}!`])("refuses token %j without a query", async (token) => {
    const db = database({ rows: [] });
    expect(await readAcademicYears(token, db.withActor)).toEqual({ kind: "unauthorized" });
    expect(db.withActor).not.toHaveBeenCalled();
  });

  it("reads the years newest first, with no parameter", async () => {
    const db = database({ rows: [{ academic_year: "2025/2026" }, { academic_year: "2026/2027" }] });
    expect(await readAcademicYears(TOKEN, db.withActor)).toEqual({ kind: "ok", years: ["2026/2027", "2025/2026"] });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]!.text).toContain("institution.institution_academic_years()");
    expect(db.calls[0]!.values).toBeUndefined();
  });

  it.each([
    ["ZD401", "unauthorized"],
    ["ZD403", "notFound"],
    ["ZD422", "unavailable"],
    ["57014", "unavailable"],
  ])("maps SQLSTATE %s to %s and logs only the code", async (code, kind) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readAcademicYears(TOKEN, database({ code }).withActor)).toEqual({ kind });
    expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
    if (kind === "unavailable") expect(log).toHaveBeenCalledWith("academic years read failed", code);
  });

  it("is unavailable when a row is malformed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readAcademicYears(TOKEN, database({ rows: [{ academic_year: "2026/2028" }] }).withActor))
      .toEqual({ kind: "unavailable" });
    expect(log).toHaveBeenCalledWith("academic years read failed", "row_malformed");
  });
});

describe("academicYearsOf", () => {
  it.each<[string, Row[]]>([
    ["a malformed year", [{ academic_year: "2026-2027" }]],
    ["a year that is not text", [{ academic_year: 2026 }]],
    ["a missing year", [{}]],
    ["the same year twice", [{ academic_year: YEAR }, { academic_year: YEAR }]],
  ])("refuses %s", (_label, rows) => expect(academicYearsOf(rows)).toBeNull());

  it("answers no years for an institution without courses", () => expect(academicYearsOf([])).toEqual([]));
});
