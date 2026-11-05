import { describe, expect, it } from "vitest";

import type { TeacherCourse, TeacherCoursesRead } from "@/server/institution/teacher-courses";

import { chooseCourse, newAssignmentHref, newAssignmentReturnTo } from "./existing-course";

// Invented courses only.
const MINE: TeacherCourse = {
  id: "00000000-0000-4000-8000-0000000000c1", name: "Kolegij A", academicYear: "2026/2027", aiPolicy: "prohibited",
  assignments: [{ id: "00000000-0000-4000-8000-0000000000a1", title: "Zadatak 1", workType: "essay",
    opensAt: "2026-10-01T07:00:00.000Z", dueAt: "2026-11-14T22:59:00.000Z", currentVersion: 1, enrolledStudents: 3 }],
};
const OK: TeacherCoursesRead = { kind: "ok", courses: [MINE] };
const OTHER = "00000000-0000-4000-8000-0000000000c9";

describe("chooseCourse (DAN-310)", () => {
  it("without ?kolegij= keeps the course-and-assignment screen", () => {
    expect(chooseCourse(undefined, null)).toEqual({ kind: "new" });
  });

  it("finds the teacher's own course and hands over only the form's fields", () => {
    expect(chooseCourse(MINE.id, OK)).toEqual({
      kind: "found", course: { id: MINE.id, name: "Kolegij A", academicYear: "2026/2027", aiPolicy: "prohibited" },
    });
    expect(chooseCourse(MINE.id.toUpperCase(), OK)).toMatchObject({ kind: "found" });
  });

  // T004 for the new entry: a course outside the teacher's own read reads the same as one that does not exist.
  it("says a course of someone else, a missing one and a malformed id the same way", () => {
    for (const param of [OTHER, "", "kolegij", `${MINE.id} `, [MINE.id, MINE.id], "../api"]) {
      expect(chooseCourse(param, OK)).toEqual({ kind: "missing" });
    }
  });

  // T001 to T003: no session, a closed one and no teacher role never select a course.
  it("selects nothing from a read the session or role refused", () => {
    expect(chooseCourse(MINE.id, null)).toEqual({ kind: "missing" });
    expect(chooseCourse(MINE.id, { kind: "unauthorized" })).toEqual({ kind: "missing" });
    expect(chooseCourse(MINE.id, { kind: "not_found" })).toEqual({ kind: "missing" });
  });

  it("says a failed read as unavailable, never as a missing course", () => {
    expect(chooseCourse(MINE.id, { kind: "unavailable" })).toEqual({ kind: "unavailable" });
  });

  it("links to the form with the course id encoded", () => {
    expect(newAssignmentHref(MINE.id)).toBe(`/nastavnik/zadatak/novi?kolegij=${MINE.id}`);
    expect(newAssignmentHref("a b&c")).toBe("/nastavnik/zadatak/novi?kolegij=a%20b%26c");
  });

  it("returns a sign-in to the same course only for a well-formed id", () => {
    expect(newAssignmentReturnTo(MINE.id)).toBe(`/nastavnik/zadatak/novi?kolegij=${MINE.id}`);
    for (const param of [undefined, "", "//evil.example", [MINE.id, MINE.id]]) {
      expect(newAssignmentReturnTo(param)).toBe("/nastavnik/zadatak/novi");
    }
  });
});
