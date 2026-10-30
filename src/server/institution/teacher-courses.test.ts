import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { coursesOf, handleTeacherCoursesRequest, readTeacherCourses } from "./teacher-courses";

// Invented courses and assignments only.
const ORIGIN = "http://localhost:3000";
const TOKEN = "T".repeat(43);
const CANARY = "kanarinac-kolegiji-7f1a";
const K1 = "00000000-0000-4000-8000-0000000000c1";
const K2 = "00000000-0000-4000-8000-0000000000c2";
const K3 = "00000000-0000-4000-8000-0000000000c3";
const Z1 = "00000000-0000-4000-8000-0000000000a1";
const Z2 = "00000000-0000-4000-8000-0000000000a2";
const Z3 = "00000000-0000-4000-8000-0000000000a3";

type Row = Record<string, unknown>;

function assignmentRow(course: Row, id: string, title: string, due: string, extra: Row = {}): Row {
  return {
    ...course,
    assignment_id: id,
    title,
    work_type: "essay",
    opens_at: new Date("2026-11-02T07:00:00Z"),
    due_at: new Date(due),
    current_version: 1,
    enrolled_students: 2,
    ...extra,
  };
}

const COURSE_K1 = { course_id: K1, course_name: "Čitanje izvora", academic_year: "2026/2027", ai_policy: "partially_allowed" };
const COURSE_K2 = { course_id: K2, course_name: "Akademsko pisanje", academic_year: "2026/2027", ai_policy: "prohibited" };
const COURSE_K3 = { course_id: K3, course_name: "Zadnji kolegij", academic_year: "2025/2026", ai_policy: "encouraged" };
const EMPTY = { assignment_id: null, title: null, work_type: null, opens_at: null, due_at: null, current_version: null, enrolled_students: null };

function database(answer: { rows?: Row[]; code?: string }) {
  const calls: string[] = [];
  const withActor = vi.fn(async (_token: string | null | undefined, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({
      async query(text: string) {
        calls.push(text);
        if (answer.code) throw Object.assign(new Error(`do not leak ${CANARY}`), { code: answer.code });
        return { rows: answer.rows ?? [], rowCount: answer.rows?.length ?? 0 };
      },
    } as unknown as ActorTransaction),
  ) as unknown as WithActor;
  return { withActor, calls };
}

const get = (headers: Record<string, string> = {}, method = "GET") =>
  new Request(`${ORIGIN}/api/teacher/courses`, { method, headers: { "sec-fetch-site": "same-origin", ...headers } });

// Left out, the cookie is TOKEN; `null` means no cookie.
const read = (db: ReturnType<typeof database>, request = get(), token: string | null = TOKEN) =>
  handleTeacherCoursesRequest(request, { withActor: db.withActor, sessionToken: token ?? undefined });

afterEach(() => vi.restoreAllMocks());

describe("GET /api/teacher/courses (DAN-230)", () => {
  it("answers the contract's fields only, ordered by year, name, due time and title", async () => {
    const db = database({
      rows: [
        { ...COURSE_K3, ...EMPTY },
        assignmentRow(COURSE_K1, Z2, "Esej B", "2026-12-01T22:59:00Z"),
        assignmentRow(COURSE_K1, Z1, "Esej A", "2026-12-01T22:59:00Z", { current_version: 3 }),
        assignmentRow(COURSE_K2, Z3, "Ćirilica", "2026-11-20T12:00:00Z", { work_type: "seminar_paper", enrolled_students: 0 }),
      ],
    });
    const response = await read(db);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toStrictEqual({
      courses: [
        {
          id: K2, name: "Akademsko pisanje", academicYear: "2026/2027", aiPolicy: "prohibited",
          assignments: [{
            id: Z3, title: "Ćirilica", workType: "seminar_paper", opensAt: "2026-11-02T07:00:00.000Z",
            dueAt: "2026-11-20T12:00:00.000Z", currentVersion: 1, enrolledStudents: 0,
          }],
        },
        {
          id: K1, name: "Čitanje izvora", academicYear: "2026/2027", aiPolicy: "partially_allowed",
          assignments: [
            { id: Z1, title: "Esej A", workType: "essay", opensAt: "2026-11-02T07:00:00.000Z", dueAt: "2026-12-01T22:59:00.000Z", currentVersion: 3, enrolledStudents: 2 },
            { id: Z2, title: "Esej B", workType: "essay", opensAt: "2026-11-02T07:00:00.000Z", dueAt: "2026-12-01T22:59:00.000Z", currentVersion: 1, enrolledStudents: 2 },
          ],
        },
        { id: K3, name: "Zadnji kolegij", academicYear: "2025/2026", aiPolicy: "encouraged", assignments: [] },
      ],
    });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toContain("FROM institution.list_teacher_courses()");
    expect(db.calls[0]).toContain("ai_policy");
  });

  it("orders names by the Croatian alphabet (č after c, before ć)", () => {
    const names = ["Ćakavski", "Cvijeće", "Čakavski", "Dž kolegij", "D kolegij"];
    const rows = names.map((name, i) => ({ course_id: `00000000-0000-4000-8000-00000000000${i}`, course_name: name, academic_year: "2026/2027", ai_policy: "prohibited", ...EMPTY }));
    expect(coursesOf(rows)?.map((course) => course.name)).toStrictEqual(["Cvijeće", "Čakavski", "Ćakavski", "D kolegij", "Dž kolegij"]);
  });

  it("answers a teacher with no course with an empty list", async () => {
    const response = await read(database({ rows: [] }));
    expect([response.status, await response.json()]).toStrictEqual([200, { courses: [] }]);
  });

  it("answers no session with 401 and anyone who is not a teacher with 404, without the database message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [{ code?: string; rows?: Row[] }, number, string][] = [
      [{ code: "ZD401" }, 401, "unauthorized"],
      [{ code: "ZD403" }, 404, "not_found"],
      [{ code: "08006" }, 503, "unavailable"],
      [{ code: "nonsense code" }, 503, "unavailable"],
    ];
    for (const [answer, status, error] of cases) {
      const response = await read(database(answer));
      expect([response.status, await response.json()]).toStrictEqual([status, { error }]);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain(CANARY);
    expect(JSON.stringify(log.mock.calls)).not.toContain("nonsense code");
  });

  it("refuses another site, another method and a missing or malformed cookie before the database", async () => {
    const cases: [Request, string | null, number, string][] = [
      [get({ "sec-fetch-site": "cross-site" }), TOKEN, 403, "forbidden"],
      [get({ "sec-fetch-site": "same-site" }), TOKEN, 403, "forbidden"],
      [get({}, "POST"), TOKEN, 405, "method_not_allowed"],
      [get(), null, 401, "unauthorized"],
      [get(), "kratki", 401, "unauthorized"],
    ];
    for (const [request, token, status, error] of cases) {
      const db = database({ rows: [] });
      const response = await read(db, request, token);
      expect([response.status, await response.json()]).toStrictEqual([status, { error }]);
      expect(db.withActor).not.toHaveBeenCalled();
    }
    // A browser without Fetch Metadata still reads: nothing here writes.
    const db = database({ rows: [] });
    const response = await read(db, new Request(`${ORIGIN}/api/teacher/courses`));
    expect(response.status).toBe(200);
  });

  it("serves nothing from a row that is not what the function returns", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = assignmentRow(COURSE_K1, Z1, "Esej A", "2026-12-01T22:59:00Z");
    const bad: Row[][] = [
      [{ ...good, course_id: "nije-uuid" }],
      [{ ...good, course_name: "" }],
      [{ ...good, academic_year: "2026" }],
      [{ ...good, assignment_id: 7 }],
      [{ ...good, title: "" }],
      [{ ...good, work_type: "novel" }],
      [{ ...good, due_at: "2026-12-01" }],
      [{ ...good, opens_at: new Date(Number.NaN) }],
      [{ ...good, current_version: 0 }],
      [{ ...good, enrolled_students: -1 }],
      [{ ...good, enrolled_students: 1.5 }],
      [good, { ...good, assignment_id: Z2, course_name: "Drugo ime" }],
      // The course's rule (DAN-344 T03): only the three rules a course can have, the same on every row of the course.
      [{ ...good, ai_policy: "allowed" }],
      [{ ...good, ai_policy: null }],
      [{ ...COURSE_K3, ...EMPTY, ai_policy: undefined }],
      [good, { ...good, assignment_id: Z2, ai_policy: "encouraged" }],
    ];
    for (const rows of bad) {
      const response = await read(database({ rows }));
      expect([response.status, await response.json()]).toStrictEqual([503, { error: "unavailable" }]);
    }
    expect(log).toHaveBeenCalledWith("teacher courses read failed", "row_malformed");
  });
});

describe("readTeacherCourses (the read behind /nastavnik, Z3 A)", () => {
  it("gives the page the same courses the route answers", async () => {
    const db = database({ rows: [assignmentRow(COURSE_K1, Z1, "Prvi", "2026-11-20T10:00:00Z"), { ...COURSE_K2, ...EMPTY }] });
    const page = await readTeacherCourses(TOKEN, db.withActor);
    const route = await (await read(db)).json();
    expect(page).toEqual({ kind: "ok", courses: route.courses });
  });

  it("names no reason beyond the route's three, and reads nothing without a well-formed cookie", async () => {
    expect(await readTeacherCourses(TOKEN, database({ code: "ZD401" }).withActor)).toEqual({ kind: "unauthorized" });
    expect(await readTeacherCourses(TOKEN, database({ code: "ZD403" }).withActor)).toEqual({ kind: "not_found" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readTeacherCourses(TOKEN, database({ code: "XX000" }).withActor)).toEqual({ kind: "unavailable" });
    const untouched = database({ rows: [] });
    expect(await readTeacherCourses(undefined, untouched.withActor)).toEqual({ kind: "unauthorized" });
    expect(await readTeacherCourses("kratko", untouched.withActor)).toEqual({ kind: "unauthorized" });
    expect(untouched.calls).toEqual([]);
  });
});
