import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { courseMotif } from "./course-motif";
import type { MyAssignmentsRead, MyCourse } from "./my-assignments-read";
import StudentHome from "./StudentHome";

const t = messagesHr.student.assignments;
const home = messagesHr.student.home;

// Invented courses and assignments only.
const COURSE_A = "00000000-0000-4000-8000-00000000000a"; // last digit a: even
const COURSE_B = "00000000-0000-4000-8000-00000000000b"; // last digit b: odd
const courses: MyCourse[] = [
  {
    id: COURSE_A,
    name: "Izmišljeni kolegij A",
    assignments: [
      { id: "10000000-0000-4000-8000-000000000001", title: "Izmišljeni esej", dueAt: "2026-11-30T22:59:00.000Z", noticeFirst: false },
      { id: "10000000-0000-4000-8000-000000000002", title: "Izmišljeni prikaz", dueAt: "2026-12-05T22:59:00.000Z", noticeFirst: true },
    ],
  },
  { id: COURSE_B, name: "Izmišljeni kolegij B", assignments: [] },
];

// Stands in for EnrollForm, a client component the page passes in.
const ENROLL = createElement("form", { "data-upis": "inline" });
const render = (read: MyAssignmentsRead) => renderToStaticMarkup(createElement(StudentHome, { read, enroll: ENROLL }));
const empty = home.empty;

describe("StudentHome, Archivum S01 on /zadaci (DAN-344)", () => {
  it("draws every own course as a card with its assignments, each through /rad", () => {
    const html = render({ kind: "ready", courses });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(home.heading);
    expect(html).toContain(home.lede);
    expect(html).toContain('href="/upis"');
    expect(html).toContain(home.courses);
    expect(html).toContain(`aria-labelledby="kolegij-${COURSE_A}"`);
    expect(html).toContain(`aria-labelledby="kolegij-${COURSE_B}"`);
    expect(html).toContain('href="/rad?zadatak=10000000-0000-4000-8000-000000000001"');
    expect(html).toContain('href="/rad?zadatak=10000000-0000-4000-8000-000000000002"');
    expect(html).toContain("Rok: 30. studenoga 2026. u 23:59");
    expect(html).toContain(t.noAssignments);
  });

  it("labels an unacknowledged notice “Pročitaj upute” and the rest “Otvori zadatak”", () => {
    const html = render({ kind: "ready", courses });
    const links = html.match(/<a [^>]*href="\/rad\?zadatak=[^"]+"[^>]*>.*?<\/a>/g) ?? [];
    expect(links).toHaveLength(2);
    expect(links[0]).toContain(home.open);
    expect(links[0]).not.toContain(home.readNotice);
    expect(links[1]).toContain(home.readNotice);
    expect(links[1]).not.toContain(home.open);
  });

  it("shows only what the read returns: no mentoring, work state or edit time", () => {
    const html = render({ kind: "ready", courses });
    expect(html).not.toMatch(/[Mm]entor/);
    expect(html).not.toMatch(/izmijenjen|predan|u tijeku/i);
  });

  it("unavailable is its own state, not the empty list and no list at all", () => {
    const html = render({ kind: "unavailable" });
    expect(html).toContain('role="alert"');
    expect(html).toContain(home.unavailableHeading);
    expect(html).toContain(home.unavailableBody);
    expect(html).toContain(`href="/zadaci"`);
    expect(html).toContain(messagesHr.auth.retry);
    expect(html).not.toContain(empty.heading);
    expect(html).not.toContain("data-upis");
    expect(html).not.toContain(home.courses);
    expect(html).not.toContain(home.lede);
    expect(html).not.toContain("/rad?zadatak=");
    expect(html).not.toContain('href="/upis"');
  });

  it("the empty list is S01_prazna with the enrolment form inline, not the unavailable state", () => {
    const html = render({ kind: "ready", courses: [] });
    expect(html).toContain(empty.heading);
    expect(html).toContain(empty.body);
    expect(html).toContain(empty.codeHeading);
    expect(html).toContain('<form data-upis="inline">');
    expect(html).toContain(empty.nextHeading);
    for (const step of empty.steps) {
      expect(html).toContain(step.title);
      expect(html).toContain(step.body);
    }
    expect(html.match(/<li/g)).toHaveLength(3);
    // The PNG's two links have no target in the product and are left out.
    expect(html).not.toMatch(/nije prikazan|nastavnik vidi/);
    expect(html).not.toContain('href="/upis"');
    expect(html).not.toContain(home.courses);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain(home.unavailableHeading);
    expect(html).not.toContain("/rad?zadatak=");
  });

  it("signed out keeps the AAI@EduHr sign-in and reads nothing", () => {
    const html = render({ kind: "signedOut" });
    expect(html).toContain(t.signedOut);
    expect(html).toContain('href="/api/auth/login?returnTo=%2Fzadaci"');
    expect(html).not.toContain(home.lede);
    expect(html).not.toContain("/rad?zadatak=");
  });

  it("S02 shows the same cards under its own heading, without the enrol action", () => {
    const html = renderToStaticMarkup(createElement(StudentHome, { read: { kind: "ready", courses }, enroll: ENROLL, view: "courses" }));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<h1[^>]*>${home.courses}</h1>`));
    expect(html).toContain(home.coursesLede);
    expect(html).not.toContain(home.heading);
    expect(html).not.toContain('href="/upis"');
    expect(html).toContain(`aria-labelledby="kolegij-${COURSE_A}"`);
    // axe heading-order: no level is skipped under the page h1.
    expect(html).toMatch(new RegExp(`<h2 id="kolegij-${COURSE_A}"`));
    expect(html).not.toContain("<h3");
    expect(html).toContain('href="/rad?zadatak=10000000-0000-4000-8000-000000000002"');
    expect(html).toContain(home.readNotice);
  });

  it("S02 keeps its own address for sign-in and retry, and its states apart", () => {
    const view = "courses" as const;
    const out = (read: MyAssignmentsRead) => renderToStaticMarkup(createElement(StudentHome, { read, enroll: ENROLL, view }));
    expect(out({ kind: "signedOut" })).toContain('href="/api/auth/login?returnTo=%2Fzadaci%2Fkolegiji"');
    const unavailable = out({ kind: "unavailable" });
    expect(unavailable).toContain('href="/zadaci/kolegiji"');
    expect(unavailable).not.toContain(empty.heading);
    expect(unavailable).not.toContain(home.coursesLede);
    const first = out({ kind: "ready", courses: [] });
    expect(first).toContain(empty.heading);
    expect(first).not.toContain('role="alert"');
  });

  it("gives each course a motif fixed by its id", () => {
    const html = render({ kind: "ready", courses });
    expect(html).toContain('data-motif="city"');
    expect(html).toContain('data-motif="research"');
    expect(courseMotif(COURSE_A)).toBe("city");
    expect(courseMotif(COURSE_B)).toBe("research");
    expect(courseMotif(COURSE_B.toUpperCase())).toBe("research");
    expect(courseMotif("nije-uuid")).toBe("city");
  });

  it("the new texts pass the forbidden terms scanner", () => {
    expect(findForbiddenTerms(JSON.stringify(home))).toEqual([]);
  });
});
