import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { AssignmentSubmission } from "@/server/evidence/assignment-submissions";
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
    id: "00000000-0000-4000-8000-0000000000c1", name: "Kolegij A", academicYear: "2026/2027", aiPolicy: "partially_allowed",
    assignments: [
      assignment("00000000-0000-4000-8000-0000000000a2", "Zadatak 2", "2026-10-31T22:59:00.000Z", 12),
      assignment("00000000-0000-4000-8000-0000000000a1", "Zadatak 1", "2026-11-14T22:59:00.000Z", 1),
    ],
  },
  { id: "00000000-0000-4000-8000-0000000000c2", name: "Kolegij B", academicYear: "2025/2026", aiPolicy: "prohibited", assignments: [] },
];

const render = (courses: TeacherCourse[], works?: Record<string, AssignmentSubmission[] | null>) =>
  renderToStaticMarkup(h(TeacherCourses, { courses, works }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const MINUTE = "2026-11-02T13:32:00.000Z";
/** A row of R1 (DAN-332): not submitted unless `afterDeadline` is given. */
const row = (studentId: string, documentId: string | null, afterDeadline?: boolean): AssignmentSubmission =>
  afterDeadline === undefined
    ? { studentId, documentId, submitted: false, revision: null, requestedMinute: null, afterDeadline: null }
    : { studentId, documentId, submitted: true, revision: 7, requestedMinute: MINUTE, afterDeadline };

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
        row(STUDENT, "izmisljeni-rad-b"),
        row("00000000-0000-4000-8000-0000000000e2", "izmisljeni rad/a"),
      ],
      "00000000-0000-4000-8000-0000000000a1": [],
    });
    expect(html).toContain('href="/nastavnik/rad/izmisljeni-rad-b"');
    expect(html).toContain('href="/nastavnik/rad/izmisljeni%20rad%2Fa"');
    expect(html.indexOf("izmisljeni-rad-b")).toBeLessThan(html.indexOf("izmisljeni%20rad"));
    expect(text(html)).toContain(`${t.work} 1 · ${t.submission.none} ${t.work} 2 · ${t.submission.none}`);
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

  describe("the state of each submission (DAN-332 PR 4, #826 c.6427128741)", () => {
    const A1 = "00000000-0000-4000-8000-0000000000a1";
    const A2 = "00000000-0000-4000-8000-0000000000a2";
    const E = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
    const items = (html: string) => [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => text(m[1]!).trim());

    it("A1: says on time, after the deadline or not submitted beside each work, in the order read", () => {
      const html = render(COURSES, { [A2]: [row(E(1), "rad-1", false), row(E(2), "rad-2", true), row(E(3), "rad-3")] });
      expect(items(html)).toEqual([
        `${t.work} 1 · ${t.submission.onTime}`,
        `${t.work} 2 · ${t.submission.afterDeadline}`,
        `${t.work} 3 · ${t.submission.none}`,
      ]);
      expect(html.indexOf("rad-1")).toBeLessThan(html.indexOf("rad-2"));
      expect(html.indexOf("rad-2")).toBeLessThan(html.indexOf("rad-3"));
    });

    it("A2: a failed read is never not submitted and never no works", () => {
      const shown = text(render(COURSES, { [A2]: null, [A1]: null }));
      expect(shown).toContain(t.worksUnavailable);
      for (const said of [t.submission.none, t.submission.onTime, t.submission.afterDeadline, t.noWorks]) {
        expect(shown).not.toContain(said);
      }
    });

    it("A3, A4: a student without a work is not listed and takes no number", () => {
      expect(text(render(COURSES, { [A2]: [row(E(1), null), row(E(2), null, false)], [A1]: [] })))
        .toContain(`${t.noWorks} `);
      expect(items(render(COURSES, { [A2]: [row(E(1), "rad-1"), row(E(2), null), row(E(3), "rad-3", true)] }))).toEqual([
        `${t.work} 1 · ${t.submission.none}`,
        `${t.work} 2 · ${t.submission.afterDeadline}`,
      ]);
    });

    it("A5: after the deadline is said only of a submitted work", () => {
      const odd = { ...row(E(1), "rad-1"), afterDeadline: true };
      expect(items(render(COURSES, { [A2]: [odd] }))).toEqual([`${t.work} 1 · ${t.submission.none}`]);
    });

    it("A6: shows no student id, revision, minute, tone or colour beside the state", () => {
      const html = render(COURSES, { [A2]: [row(E(1), "rad-1", false), row(E(2), "rad-2", true), row(E(3), "rad-3")] });
      for (const hidden of [E(1), E(2), E(3), MINUTE, "13:32", "data-tone", "style=", "color"]) {
        expect(html).not.toContain(hidden);
      }
      expect(text(html)).not.toMatch(/\b7\b/);
    });

    it("A7: the state of one assignment never moves to another", () => {
      const html = render(COURSES, { [A2]: [row(E(1), "rad-a2", true)], [A1]: [row(E(1), "rad-a1")] });
      expect(items(html)).toEqual([`${t.work} 1 · ${t.submission.afterDeadline}`, `${t.work} 1 · ${t.submission.none}`]);
      expect(html.indexOf("rad-a2")).toBeLessThan(html.indexOf("rad-a1"));
    });

    it("A8: the link still encodes the work id", () => {
      expect(render(COURSES, { [A2]: [row(E(1), "rad x/1", false)] })).toContain('href="/nastavnik/rad/rad%20x%2F1"');
    });
  });

  // DAN-310 (M2.4-P01): every course, with or without assignments, offers a further one in itself.
  it("links each course to a new assignment in that course", () => {
    const html = render(COURSES);
    for (const course of COURSES) {
      expect(html).toContain(`href="/nastavnik/zadatak/novi?kolegij=${course.id}"`);
    }
    expect(html.split(messagesHr.teacher.existingCourse.link).length - 1).toBe(COURSES.length);
    expect(render([])).not.toContain("?kolegij=");
  });

  it("uses no forbidden term", () => {
    const works = { "00000000-0000-4000-8000-0000000000a2": [row("00000000-0000-4000-8000-0000000000e1", "d"),
      row("00000000-0000-4000-8000-0000000000e2", "e", false), row("00000000-0000-4000-8000-0000000000e3", "f", true)],
      "00000000-0000-4000-8000-0000000000a1": null };
    expect(findForbiddenTerms(text(render(COURSES)) + text(render([])) + text(render(COURSES, works))
      + text(render(COURSES, { "00000000-0000-4000-8000-0000000000a1": [] })))).toEqual([]);
  });
});
