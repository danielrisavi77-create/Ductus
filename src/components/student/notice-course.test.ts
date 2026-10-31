import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import AssignmentNotice, { NoticeMeta } from "./AssignmentNotice";
import type { NoticeView } from "./assignment-notice-read";
import type { MyCourse } from "./my-assignments-read";
import { CourseEyebrow } from "./NoticeCourse";
import { noticeCourse } from "./notice-course";

const s = messagesHr.student;

// Invented courses and assignments only.
const COURSE_A = "00000000-0000-4000-8000-00000000000a";
const COURSE_B = "00000000-0000-4000-8000-00000000000b";
const MINE = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const NOWHERE = "10000000-0000-4000-8000-000000000003";
const assignment = (id: string) => ({ id, title: "Izmišljeni esej", dueAt: "2026-11-30T22:59:00.000Z", noticeFirst: true });
const courses: MyCourse[] = [
  { id: COURSE_A, name: "Izmišljeni kolegij A", assignments: [assignment(OTHER)] },
  { id: COURSE_B, name: "Izmišljeni kolegij B", assignments: [assignment(MINE)] },
];

describe("noticeCourse, the course above the S03 notice (DAN-344 S03-a)", () => {
  it("is the course whose list holds this assignment, never another one", () => {
    expect(noticeCourse({ kind: "ready", courses }, MINE)).toEqual({ id: COURSE_B, name: "Izmišljeni kolegij B" });
    expect(noticeCourse({ kind: "ready", courses }, OTHER)).toEqual({ id: COURSE_A, name: "Izmišljeni kolegij A" });
    expect(noticeCourse({ kind: "ready", courses }, MINE.toUpperCase())?.id).toBe(COURSE_B);
  });

  it("is nothing when the assignment is on no list or the read is not ready", () => {
    expect(noticeCourse({ kind: "ready", courses }, NOWHERE)).toBeNull();
    expect(noticeCourse({ kind: "ready", courses: [] }, MINE)).toBeNull();
    expect(noticeCourse({ kind: "signedOut" }, MINE)).toBeNull();
    expect(noticeCourse({ kind: "unavailable" }, MINE)).toBeNull();
  });
});

describe("S03-a header", () => {
  it("draws the eyebrow with the course name and its motif, and nothing without a course", () => {
    const html = renderToStaticMarkup(createElement(CourseEyebrow, { course: { id: COURSE_B, name: "Izmišljeni kolegij B" } }));
    expect(html).toContain(s.courseEyebrow);
    expect(html).toContain("Izmišljeni kolegij B");
    expect(html).toContain('data-motif="research"');
    expect(html).not.toContain("<h1");
    expect(renderToStaticMarkup(createElement(CourseEyebrow, { course: null }))).toBe("");
  });

  it("shows only the work type and range readNotice returned, then the due line", () => {
    const both = renderToStaticMarkup(createElement(NoticeMeta, { kind: "Seminarski rad · 1500–2000 riječi", due: "Rok: x" }));
    expect(both).toContain("Seminarski rad · 1500–2000 riječi");
    expect(both).toContain("Rok: x");
    expect(both.match(/aria-hidden="true"/g)).toHaveLength(2);
    const dueOnly = renderToStaticMarkup(createElement(NoticeMeta, { kind: "", due: "Rok: x" }));
    expect(dueOnly.match(/<svg/g)).toHaveLength(1);
  });

  it("has the kicker “Prije pisanja”, one h1 and no “otvoreno od”", () => {
    const view: NoticeView = {
      assignmentId: MINE, versionNo: 1, title: "Izmišljeni esej", instructions: "Izmišljene upute.",
      workType: "nepoznata_vrsta", evidenceProfile: "basic", opensAt: "2026-11-01T08:00:00.000Z",
      dueAt: "2026-11-30T22:59:00.000Z", aiPurposes: [], wordMin: null, wordMax: null, acknowledgedAt: null,
    };
    const html = renderToStaticMarkup(createElement(AssignmentNotice, { view, timing: "open" }));
    expect(html).toContain(s.step);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toContain("otvoreno od");
    expect(html).not.toContain("nepoznata_vrsta");
    // Dates are shown only in the browser; the server renders "…".
    expect(html).toContain(s.dueAt.replace("{time}", "…"));
  });

  it("uses no forbidden term in the new header text", () => {
    expect(findForbiddenTerms([s.step, s.courseEyebrow, s.dueAt].join("\n"))).toEqual([]);
  });
});
