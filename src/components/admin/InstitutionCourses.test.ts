import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { CoursePerson, InstitutionCourse, InstitutionGroup } from "@/server/institution/institution-courses";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import InstitutionCourses from "./InstitutionCourses";

// DAN-591 (A-03): invented courses, groups and people only.
const t = messagesHr.institutionCourses;
const HREF = "/ustanova/kolegiji";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (n: number, givenName: string, familyName: string): CoursePerson =>
  ({ personId: id(100 + n), name: { givenName, familyName } });
const ANA = person(1, "Ana", "Primjer");
const IVO = person(2, "Ivo", "Izmišljeni");
const UNNAMED: CoursePerson = { personId: id(103), name: null };

const group = (n: number, over: Partial<InstitutionGroup> = {}): InstitutionGroup =>
  ({ groupId: id(200 + n), name: `Grupa ${n}`, students: 0, teachers: [], ...over });
const course = (n: number, over: Partial<InstitutionCourse> = {}): InstitutionCourse =>
  ({ courseId: id(n), name: `Kolegij ${n}`, students: 0, holder: null, team: [], groups: [], ...over });

const render = (props: { years: string[]; year: string | null; courses: InstitutionCourse[] }) =>
  renderToStaticMarkup(h(InstitutionCourses, { href: HREF, ...props }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const articles = (html: string) => [...html.matchAll(/<article[\s\S]*?<\/article>/g)].map((m) => m[0]);

const FULL = course(1, {
  name: "Uvod u izmišljene studije",
  students: 22,
  holder: ANA,
  team: [IVO, ANA],
  groups: [
    group(1, { students: 11, teachers: [IVO] }),
    group(2, { students: 1, teachers: [IVO, ANA] }),
    group(3, { students: 5 }),
  ],
});

describe("InstitutionCourses", () => {
  it("shows the institution's empty state when it has no academic year", () => {
    const html = render({ years: [], year: null, courses: [] });
    expect(text(html)).toBe(`${t.noCourses} ${t.emptyNote}`);
    expect(html).not.toContain("<nav");
  });

  it("names the chosen year and marks only its link as current", () => {
    const html = render({ years: ["2027/2028", "2026/2027", "2025/2026"], year: "2026/2027", courses: [] });
    expect(html).toContain(`<h2 id="akademska-godina">${t.yearHeading.replace("{year}", "2026./2027.")}</h2>`);
    const links = [...html.matchAll(/<a [^>]*>[^<]*<\/a>/g)].map((m) => m[0]);
    expect(links).toHaveLength(3);
    expect(links.filter((l) => l.includes('aria-current="page"'))).toEqual([
      expect.stringContaining('href="/ustanova/kolegiji?godina=2026%2F2027"'),
    ]);
    expect(links[0]).toContain(">2027./2028.<");
    expect(html).toContain(`aria-label="${t.yearsLabel}"`);
  });

  it("shows the empty year with the note, not an empty list", () => {
    const html = render({ years: ["2026/2027"], year: "2026/2027", courses: [] });
    expect(articles(html)).toEqual([]);
    expect(text(html)).toContain(`${t.emptyYear} ${t.emptyNote}`);
  });

  it("shows one labelled card per course in the read's order", () => {
    const html = render({ years: ["2026/2027"], year: "2026/2027", courses: [course(2), course(1)] });
    const cards = articles(html);
    expect(cards.map((c) => c.match(/<h3[^>]*>([^<]*)<\/h3>/)![1])).toEqual(["Kolegij 2", "Kolegij 1"]);
    expect(cards[0]).toContain(`aria-labelledby="kolegij-${id(2)}"`);
    expect(cards[0]).toContain(`<h3 id="kolegij-${id(2)}">`);
  });

  it("shows the holder, the team and every group with its teachers and student count", () => {
    const card = text(articles(render({ years: ["2026/2027"], year: "2026/2027", courses: [FULL] }))[0]!);
    expect(card).toContain("22 upisana studenta");
    expect(card).toContain(`${t.holder} Ana Primjer`);
    expect(card).toContain(`${t.team} Ivo Izmišljeni, Ana Primjer`);
    expect(card).toContain(`Grupa 1 ${t.groupTeacher.one}: Ivo Izmišljeni 11 studenata`);
    expect(card).toContain(`Grupa 2 ${t.groupTeacher.many}: Ivo Izmišljeni, Ana Primjer 1 student`);
    expect(card).toContain(`Grupa 3 ${t.noTeacher} ${t.noTeacherNote} 5 studenata`);
  });

  it("says when a course has no holder, no team or no groups", () => {
    const card = text(articles(render({ years: ["2026/2027"], year: "2026/2027", courses: [course(1)] }))[0]!);
    expect(card).toContain(`${t.holder} ${t.noHolder}`);
    expect(card).toContain(`${t.team} ${t.noTeam}`);
    expect(card).toContain(t.noGroups);
    expect(card).toContain("0 upisanih studenata");
  });

  it("shows a person without a name as such, never as an identifier", () => {
    const c = course(1, { holder: UNNAMED, team: [UNNAMED], groups: [group(1, { teachers: [UNNAMED] })] });
    const html = render({ years: ["2026/2027"], year: "2026/2027", courses: [c] });
    expect(text(html)).toContain(`${t.holder} ${messagesHr.teacherRoles.unnamed}`);
    expect(html).not.toContain(UNNAMED.personId);
  });

  it.each([
    [0, "upisanih studenata", "studenata"], [1, "upisan student", "student"], [2, "upisana studenta", "studenta"],
    [5, "upisanih studenata", "studenata"], [11, "upisanih studenata", "studenata"],
    [21, "upisan student", "student"], [22, "upisana studenta", "studenta"], [112, "upisanih studenata", "studenata"],
  ])("counts %i students in the Croatian plural", (n, enrolled, students) => {
    const c = course(1, { students: n, groups: [group(1, { students: n })] });
    const card = text(articles(render({ years: ["2026/2027"], year: "2026/2027", courses: [c] }))[0]!);
    expect(card).toContain(`${n} ${enrolled}`);
    const groupPart = card.slice(card.indexOf("Grupa 1 "));
    expect(groupPart.startsWith("Grupa 1 ")).toBe(true);
    expect(groupPart.endsWith(` ${n} ${students}`)).toBe(true);
  });

  it("escapes course, group and person names", () => {
    const c = course(1, {
      name: "<script>x</script> & \"A\"",
      holder: person(9, "<b>", "&amp;"),
      groups: [group(1, { name: "<img src=x>" })],
    });
    const html = render({ years: ["2026/2027"], year: "2026/2027", courses: [c] });
    expect(html).not.toMatch(/<script|<b>|<img/);
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; &quot;A&quot;");
    expect(html).toContain("&lt;b&gt; &amp;amp;");
  });

  it("uses no forbidden term in any state", () => {
    const states = [
      render({ years: [], year: null, courses: [] }),
      render({ years: ["2026/2027"], year: "2026/2027", courses: [] }),
      render({ years: ["2026/2027"], year: "2026/2027", courses: [FULL, course(2)] }),
    ];
    for (const html of states) expect(findForbiddenTerms(text(html))).toEqual([]);
    expect(findForbiddenTerms(Object.values(t).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v))).join(" ")))
      .toEqual([]);
  });
});
