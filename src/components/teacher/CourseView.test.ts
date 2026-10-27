import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { AssignmentWork } from "@/server/evidence/assignment-works";
import type { TeacherCourse, TeacherCoursesRead } from "@/server/institution/teacher-courses";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import CourseView, { courseOf } from "./CourseView";

// DAN-344, Archivum T02 (#923 c.6433823712 §3 and §9 T-b). Invented courses only.
const t = messagesHr.teacherCourse;
const tc = messagesHr.teacherCourses;
const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";
const A1 = "00000000-0000-4000-8000-0000000000a1";
const A2 = "00000000-0000-4000-8000-0000000000a2";
const A3 = "00000000-0000-4000-8000-0000000000a3";
const assignment = (id: string, title: string, dueAt: string, workType = "seminar_paper") => ({
  id, title, workType, opensAt: "2026-10-01T07:00:00.000Z", dueAt, currentVersion: 1, enrolledStudents: 24,
});
const COURSE: TeacherCourse = {
  id: C1, name: "Izmišljeni kolegij", academicYear: "2026/2027",
  assignments: [
    assignment(A2, "Prvi izmišljeni zadatak", "2026-11-06T22:59:00.000Z"),
    assignment(A1, "Drugi izmišljeni zadatak", "2026-11-13T22:59:00.000Z", "essay"),
    assignment(A3, "Treći izmišljeni zadatak", "2026-11-20T22:59:00.000Z"),
  ],
};
const OTHER: TeacherCourse = { id: C2, name: "Drugi kolegij", academicYear: "2026/2027", assignments: [] };
const READ: TeacherCoursesRead = { kind: "ok", courses: [COURSE, OTHER] };
const w = (n: number): AssignmentWork[] =>
  Array.from({ length: n }, (_, i) => ({ studentId: `00000000-0000-4000-8000-0000000000e${i}`, documentId: `izmisljeni-rad-${i}` }));
const WORKS = { [A2]: w(2), [A1]: w(1), [A3]: [] };

const render = (read: TeacherCoursesRead | null, courseId: string, works: Record<string, AssignmentWork[] | null> = {}) =>
  renderToStaticMarkup(h(CourseView, { read, courseId, works }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const h1s = (html: string) => [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map((m) => m[1]);

describe("CourseView (Archivum T02)", () => {
  it("finds the course only in the read, by its id in any case", () => {
    expect(courseOf(READ, C1)).toBe(COURSE);
    expect(courseOf(READ, C1.toUpperCase())).toBe(COURSE);
    expect(courseOf(READ, "00000000-0000-4000-8000-0000000000c9")).toBeNull();
    expect(courseOf({ kind: "not_found" }, C1)).toBeNull();
    expect(courseOf(null, C1)).toBeNull();
  });

  it("titles the page with the course and its year, with the motif of its id and one h1", () => {
    const html = render(READ, C1, WORKS);
    expect(h1s(html)).toEqual([COURSE.name]);
    expect(text(html)).toContain(t.year.replace("{year}", "2026./2027."));
    expect(html).toContain('data-motif="research"');
    expect(html).toMatch(/<h2[^>]*>Zadaci<\/h2>/);
    expect(html).not.toContain('role="tablist"');
  });

  it("lists the assignments in the read's order with type and due time in Europe/Zagreb", () => {
    const shown = text(render(READ, C1, WORKS));
    const at = ["Prvi izmišljeni", "Drugi izmišljeni", "Treći izmišljeni"].map((s) => shown.indexOf(s));
    expect(at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1]!))).toBe(true);
    expect(shown).toContain("Seminarski rad 6. studenoga 2026. u 23:59");
    expect(shown).toContain("Esej 13. studenoga 2026. u 23:59");
  });

  it("counts the available works of each assignment, never as submitted ones, and says so", () => {
    const shown = text(render(READ, C1, WORKS));
    expect(shown).toContain(`2 ${t.works.few}`);
    expect(shown).toContain(`1 ${t.works.one}`);
    expect(shown).toContain(t.noWorks);
    expect(shown).toContain(t.worksNote);
    expect(shown.replace(t.worksNote, "")).not.toMatch(/predan/i);
  });

  it("links every work to its live view, numbered in the order read, and each assignment to its fast path", () => {
    const html = render(READ, C1, WORKS);
    expect(html).toContain('href="/nastavnik/rad/izmisljeni-rad-0"');
    expect(html).toContain('href="/nastavnik/rad/izmisljeni-rad-1"');
    expect(html).toContain(`href="/nastavnik/brz-put?zadatak=${A2}"`);
    expect(html).toContain(`href="/nastavnik/brz-put?zadatak=${A3}"`);
    expect(html).not.toContain("00000000-0000-4000-8000-0000000000e0");
    expect(text(html)).toContain(`${tc.work} 1 ${tc.work} 2`);
  });

  it("says that works could not be read, never that there are none, and links none", () => {
    const html = render(READ, C1, { [A2]: null, [A1]: null, [A3]: null });
    expect(text(html)).toContain(tc.worksUnavailable);
    expect(text(html)).not.toContain(t.noWorks);
    expect(html).not.toContain("/nastavnik/rad/");
  });

  it("shows no student: no tab, no number of students and no name", () => {
    const shown = text(render(READ, C1, WORKS));
    expect(shown).not.toMatch(/Studenti|studenata|studenta|24/);
    expect(shown).not.toMatch(/ISVU|Dodaj zadatak|Prikaži radove|Ogledni|Vizualni/);
  });

  it("says that a course has no assignment yet", () => {
    expect(text(render(READ, C2))).toContain(tc.noAssignments);
  });

  it("gives an unknown course, another teacher's and a refused read one and the same 'not found'", () => {
    const unknown = render(READ, "00000000-0000-4000-8000-0000000000c9");
    expect(text(unknown)).toContain(t.notFound);
    expect(unknown).toContain('href="/nastavnik"');
    expect(h1s(unknown)).toHaveLength(1);
    expect(render({ kind: "not_found" }, C1)).toBe(unknown);
    expect(render({ kind: "unauthorized" }, C1)).toBe(unknown);
    expect(render({ kind: "ok", courses: [OTHER] }, C1)).toBe(unknown);
    expect(render(READ, "not-a-uuid")).toBe(unknown);
  });

  it("keeps a failed read apart from 'not found'", () => {
    const html = render({ kind: "unavailable" }, C1);
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(tc.unavailable);
    expect(text(html)).not.toContain(t.notFound);
  });

  it("asks a signed-out visitor to sign in and come back to this course", () => {
    const html = render(null, C1);
    expect(text(html)).toContain(messagesHr.teacher.signedOut);
    expect(html).toContain(`href="/api/auth/login?returnTo=%2Fnastavnik%2Fkolegij%2F${C1}"`);
    expect(text(html)).not.toContain(COURSE.name);
  });

  it("uses no forbidden term", () => {
    const all = [render(READ, C1, WORKS), render(READ, C2), render(READ, "x"), render({ kind: "unavailable" }, C1), render(null, C1),
      render(READ, C1, { [A2]: null })];
    expect(findForbiddenTerms(all.map(text).join(" "))).toEqual([]);
  });
});
