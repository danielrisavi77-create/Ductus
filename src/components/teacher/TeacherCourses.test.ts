import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { AssignmentWork } from "@/server/evidence/assignment-works";
import type { TeacherCourse } from "@/server/institution/teacher-courses";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import TeacherCourses from "./TeacherCourses";

// Invented courses and assignments only.
const t = messagesHr.teacherCourses;
const assignment = (id: string, title: string, dueAt: string, enrolledStudents: number) => ({
  id, title, workType: "seminar_paper", opensAt: "2026-10-01T07:00:00.000Z", dueAt, currentVersion: 1, enrolledStudents,
});
const COURSES: TeacherCourse[] = [
  {
    id: "00000000-0000-4000-8000-0000000000c1", name: "Kolegij A", academicYear: "2026/2027",
    assignments: [
      assignment("00000000-0000-4000-8000-0000000000a2", "Zadatak 2", "2026-10-31T22:59:00.000Z", 12),
      assignment("00000000-0000-4000-8000-0000000000a1", "Zadatak 1", "2026-11-14T22:59:00.000Z", 1),
    ],
  },
  { id: "00000000-0000-4000-8000-0000000000c2", name: "Kolegij B", academicYear: "2025/2026", assignments: [] },
];

const render = (courses: TeacherCourse[], works?: Record<string, AssignmentWork[] | null>) =>
  renderToStaticMarkup(h(TeacherCourses, { courses, works }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("TeacherCourses (Z3 A)", () => {
  it("draws courses and assignments in the order they arrive, never by the number of students", () => {
    const html = render(COURSES);
    const order = ["Kolegij A", "Zadatak 2", "Zadatak 1", "Kolegij B"].map((s) => html.indexOf(s));
    expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]!))).toBe(true);
    expect(text(html)).toContain("12 studenata");
    expect(text(html)).toContain("1 student ");
    expect(text(html)).toContain(t.noAssignments);
    expect(text(html)).toContain(t.countNote);
  });

  it("shows the due time in Europe/Zagreb and the academic year as the form writes it", () => {
    const shown = text(render(COURSES));
    expect(shown).toContain("rok 31. listopada 2026. u 23:59");
    expect(shown).toContain("rok 14. studenoga 2026. u 23:59");
    expect(shown).toContain("2026./2027.");
    expect(shown).toContain("Seminarski rad ·");
  });

  it("offers a new course when there is none, and nothing else", () => {
    const html = render([]);
    expect(text(html)).toContain(t.empty);
    expect(html).toContain('href="/nastavnik/zadatak/novi"');
    expect(text(html)).not.toContain(t.countNote);
  });

  it("links every work of an assignment to its live view, numbered in the order read, with no student id", () => {
    const STUDENT = "00000000-0000-4000-8000-0000000000e1";
    const html = render(COURSES, {
      "00000000-0000-4000-8000-0000000000a2": [
        { studentId: STUDENT, documentId: "izmisljeni-rad-b" },
        { studentId: "00000000-0000-4000-8000-0000000000e2", documentId: "izmisljeni rad/a" },
      ],
      "00000000-0000-4000-8000-0000000000a1": [],
    });
    expect(html).toContain('href="/nastavnik/rad/izmisljeni-rad-b"');
    expect(html).toContain('href="/nastavnik/rad/izmisljeni%20rad%2Fa"');
    expect(html.indexOf("izmisljeni-rad-b")).toBeLessThan(html.indexOf("izmisljeni%20rad"));
    expect(text(html)).toContain(`${t.work} 1 ${t.work} 2`);
    expect(text(html)).toContain(t.noWorks);
    expect(html).not.toContain(STUDENT);
  });

  it("says that works could not be read, and links none", () => {
    const html = render(COURSES, { "00000000-0000-4000-8000-0000000000a1": null });
    expect(text(html)).toContain(t.worksUnavailable);
    expect(text(html)).not.toContain(t.noWorks);
    expect(html).not.toContain("/nastavnik/rad/");
  });

  it("draws no works line for an assignment whose works were not asked for", () => {
    const shown = text(render(COURSES));
    expect(shown).not.toContain(t.noWorks);
    expect(shown).not.toContain(t.worksUnavailable);
  });

  it("uses no forbidden term", () => {
    const works = { "00000000-0000-4000-8000-0000000000a2": [{ studentId: "00000000-0000-4000-8000-0000000000e1", documentId: "d" }],
      "00000000-0000-4000-8000-0000000000a1": null };
    expect(findForbiddenTerms(text(render(COURSES)) + text(render([])) + text(render(COURSES, works))
      + text(render(COURSES, { "00000000-0000-4000-8000-0000000000a1": [] })))).toEqual([]);
  });
});
