import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { TeacherCourse } from "@/server/institution/teacher-courses";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import TeacherCourses from "./TeacherCourses";

// Invented courses and assignments only. The assignments, works and fast path
// moved to the course page (T02, CourseView.test.ts); the empty state is in
// TeacherHome.test.ts.
const t = messagesHr.teacherCourses;
const assignment = (id: string, title: string, dueAt: string, enrolledStudents: number) => ({
  id, title, workType: "seminar_paper", opensAt: "2026-10-01T07:00:00.000Z", dueAt, currentVersion: 1, enrolledStudents,
});
const COURSES: TeacherCourse[] = [
  {
    id: "00000000-0000-4000-8000-0000000000c1", name: "Kolegij A", academicYear: "2026/2027",
    assignments: [assignment("00000000-0000-4000-8000-0000000000a2", "Zadatak 2", "2026-10-31T22:59:00.000Z", 12)],
  },
  { id: "00000000-0000-4000-8000-0000000000c2", name: "Kolegij B", academicYear: "2025/2026", assignments: [] },
];

const render = (courses: TeacherCourse[]) => renderToStaticMarkup(h(TeacherCourses, { courses }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("TeacherCourses (Archivum T01)", () => {
  it("draws the courses in the order they arrive", () => {
    const html = render(COURSES);
    expect(html.indexOf("Kolegij A")).toBeLessThan(html.indexOf("Kolegij B"));
  });

  it("draws each course as a card with its name, the course label and the motif fixed by its id", () => {
    const html = render(COURSES);
    expect(html).toMatch(/<h2[^>]*>Moji kolegiji<\/h2>/);
    expect(html).toMatch(/<h3 id="kolegij-00000000-0000-4000-8000-0000000000c1"[^>]*>Kolegij A<\/h3>/);
    expect(html).toContain('aria-labelledby="kolegij-00000000-0000-4000-8000-0000000000c2"');
    expect(html).toContain('data-motif="research"');
    expect(html).toContain('data-motif="city"');
    expect(html.match(new RegExp(`<p[^>]*>${t.courseLabel}</p>`, "g"))).toHaveLength(2);
    expect(text(html)).toContain(t.inside);
  });

  it("leads each card to its own course page, then offers only the small way to a new course", () => {
    const hrefs = [...render(COURSES).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      "/nastavnik/kolegij/00000000-0000-4000-8000-0000000000c1",
      "/nastavnik/kolegij/00000000-0000-4000-8000-0000000000c2",
      "/nastavnik/zadatak/novi",
    ]);
    expect(text(render(COURSES))).toContain(t.openCourse);
  });

  it("puts a year shared by every course once beside the heading, and a mixed year on each card", () => {
    const same = COURSES.map((course) => ({ ...course, academicYear: "2026/2027" }));
    const once = text(render(same));
    expect(once.split("2026./2027.").length - 1).toBe(1);
    expect(once.indexOf("2026./2027.")).toBeLessThan(once.indexOf("Kolegij A"));
    const mixed = text(render(COURSES));
    expect(mixed.indexOf("2026./2027.")).toBeGreaterThan(mixed.indexOf("Kolegij A"));
    expect(mixed.indexOf("2025./2026.")).toBeGreaterThan(mixed.indexOf("Kolegij B"));
  });

  it("shows no assignment, number of students or work on the home page", () => {
    const shown = text(render(COURSES));
    expect(shown).not.toMatch(/Zadatak 2|studen|Rad 1/);
  });

  it("uses no forbidden term", () => {
    expect(findForbiddenTerms(text(render(COURSES)))).toEqual([]);
  });
});
