import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { TeacherCourse, TeacherCoursesRead } from "@/server/institution/teacher-courses";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import TeacherHome from "./TeacherHome";

// DAN-344, Archivum T01 (#923 c.6433823712 §2 and §9 T-a). Invented courses only.
const t = messagesHr.teacherCourses;
const COURSE: TeacherCourse = {
  id: "00000000-0000-4000-8000-0000000000c1", name: "Izmišljeni kolegij", academicYear: "2026/2027", assignments: [],
};

const render = (read: TeacherCoursesRead | null) => renderToStaticMarkup(h(TeacherHome, { read }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const h1s = (html: string) => [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)].map((m) => m[1]);

const STATES: [string, TeacherCoursesRead | null][] = [
  ["signed out", null],
  ["unavailable", { kind: "unavailable" }],
  ["refused", { kind: "unauthorized" }],
  ["not a teacher", { kind: "not_found" }],
  ["no course", { kind: "ok", courses: [] }],
  ["one course", { kind: "ok", courses: [COURSE] }],
];

describe("TeacherHome (Archivum T01)", () => {
  it("has exactly one h1 in every state", () => {
    for (const [, read] of STATES) expect(h1s(render(read))).toHaveLength(1);
  });

  it("titles a listed home 'Vaš nastavni prostor' with its lede and keeps a small way to a new course under the cards", () => {
    const html = render({ kind: "ok", courses: [COURSE] });
    expect(h1s(html)).toEqual([t.heading]);
    expect(text(html)).toContain(t.lede);
    // Owner, #923 c.6435071376 point 2: the link sits after the cards, not in the heading.
    expect(html.indexOf('href="/nastavnik/zadatak/novi"')).toBeGreaterThan(html.indexOf(COURSE.name));
    expect(html).toMatch(/<a href="\/nastavnik\/zadatak\/novi">Novi kolegij<\/a>/);
    expect(text(html)).not.toContain(t.newCourse);
    expect(text(html)).toContain(COURSE.name);
    expect(text(html)).not.toContain(t.empty);
  });

  it("shows the first-course state for a read that loaded no course, with its steps and the existing form as the way on", () => {
    const html = render({ kind: "ok", courses: [] });
    expect(h1s(html)).toEqual([t.title]);
    const shown = text(html);
    for (const line of [t.emptyLede, t.firstStep, t.empty, t.emptyLead, t.emptyNext, t.emptyNote]) expect(shown).toContain(line);
    for (const step of t.emptySteps) {
      expect(shown).toContain(step.title);
      expect(shown).toContain(step.body);
    }
    expect(html).toMatch(/<h2[^>]*>Pripremite prvi kolegij\.<\/h2>/);
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/nastavnik/zadatak/novi"]);
    expect(shown).not.toContain(t.inside);
  });

  it("gives a refused session and a person who is not a teacher the same state as no course, without saying which", () => {
    const empty = render({ kind: "ok", courses: [] });
    expect(render({ kind: "unauthorized" })).toBe(empty);
    expect(render({ kind: "not_found" })).toBe(empty);
  });

  it("never draws a failed read as the first-course state", () => {
    const html = render({ kind: "unavailable" });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(t.unavailable);
    expect(html).toContain('href="/nastavnik"');
    expect(text(html)).not.toContain(t.empty);
    expect(text(html)).not.toContain(t.newCourse);
  });

  it("asks a signed-out visitor to sign in through AAI@EduHr and shows nothing else", () => {
    const html = render(null);
    expect(text(html)).toContain(messagesHr.teacher.signedOut);
    expect(html).toContain('href="/api/auth/login?returnTo=%2Fnastavnik"');
    expect(text(html)).not.toContain(t.empty);
    expect(text(html)).not.toContain(t.lede);
  });

  it("names no mentorship, no ISVU and no link without a target in any state", () => {
    for (const [, read] of STATES) {
      const shown = text(render(read));
      expect(shown).not.toMatch(/mentorstv|ISVU|Kako studenti ulaze|Dodaj zadatak|Ogledni|Vizualni/);
    }
  });

  it("uses no forbidden term", () => {
    expect(findForbiddenTerms(STATES.map(([, read]) => text(render(read))).join(" "))).toEqual([]);
  });
});
