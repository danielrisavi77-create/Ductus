import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { MentoredWork } from "@/server/institution/mentored-works";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import MentoredWorks from "./MentoredWorks";
import { byFamilyName, liveHref, stateText, studentName } from "./mentored-works-view";

// Invented students, titles and ids only.
const t = messagesHr.mentoredWorks;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const work = (n: number, student: MentoredWork["student"], over: Partial<MentoredWork> = {}): MentoredWork => ({
  mentorshipId: id(n), assignmentId: id(100 + n), documentId: `doc-${n}`, student,
  title: `Naslov ${n}`, workType: "bachelor_thesis", workState: "in_progress", ...over,
});
const WORKS: MentoredWork[] = [
  work(1, { givenName: "Vesna", familyName: "Žbunić" }),
  work(2, null, { documentId: null, workState: "not_started" }),
  work(3, { givenName: "Ante", familyName: "Čvorić" }, { workState: "submitted", workType: "master_thesis" }),
  work(4, { givenName: "Borna", familyName: "Crtić" }),
  work(5, { givenName: "Ana", familyName: "Crtić" }),
];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("byFamilyName (N-16)", () => {
  it("orders by family name, then given name, in Croatian order, a student without a name last", () => {
    expect(byFamilyName(WORKS).map(studentName)).toEqual(
      ["Ana Crtić", "Borna Crtić", "Ante Čvorić", "Vesna Žbunić", t.unnamed]);
  });

  it("breaks a tie by the mentorship id, never by the order the read returns", () => {
    const same = [work(9, { givenName: "Ivo", familyName: "Izmišljenić" }), work(8, { givenName: "Ivo", familyName: "Izmišljenić" })];
    expect(byFamilyName(same).map((w) => w.mentorshipId)).toEqual([id(8), id(9)]);
    expect(byFamilyName([...same].reverse()).map((w) => w.mentorshipId)).toEqual([id(8), id(9)]);
  });

  it("does not change the list it is given", () => {
    const copy = [...WORKS];
    byFamilyName(WORKS);
    expect(WORKS).toEqual(copy);
  });
});

describe("the row of one work", () => {
  it("says the state in words only", () => {
    expect(stateText(WORKS[0]!)).toBe("U pisanju");
    expect(stateText(WORKS[1]!)).toBe("Student još nije započeo rad.");
    expect(stateText(WORKS[2]!)).toBe("Predano");
  });

  it("links a started work to the live view and a work not yet started to nothing", () => {
    expect(liveHref(work(7, null, { documentId: "a b/c" }))).toBe("/nastavnik/rad/a%20b%2Fc");
    expect(liveHref(WORKS[1]!)).toBeNull();
  });
});

describe("MentoredWorks", () => {
  it("draws every work with its student, title, type and state, and the order note", () => {
    const shown = text(renderToStaticMarkup(h(MentoredWorks, { works: WORKS })));
    expect(shown).toContain(t.listTitle);
    expect(shown).toContain("Ante Čvorić Naslov 3 Diplomski rad · Predano");
    expect(shown).toContain(`${t.unnamed} Naslov 2 Završni rad · Student još nije započeo rad.`);
    expect(shown).toContain(t.orderNote);
    expect(shown.indexOf("Ana Crtić")).toBeLessThan(shown.indexOf("Vesna Žbunić"));
  });

  it("gives one link per started work, none for a work not yet started", () => {
    const html = renderToStaticMarkup(h(MentoredWorks, { works: WORKS }));
    expect(html.match(/href="\/nastavnik\/rad\//g)).toHaveLength(4);
    expect(html).not.toContain("/nastavnik/rad/doc-2");
  });

  it("says there is no open mentorship when the list is empty, and no order note", () => {
    const shown = text(renderToStaticMarkup(h(MentoredWorks, { works: [] })));
    expect(shown).toContain(t.empty);
    expect(shown).not.toContain(t.orderNote);
  });

  it("shows no time, number, stage, rubric or grade of a work", () => {
    const shown = text(renderToStaticMarkup(h(MentoredWorks, { works: WORKS })));
    expect(shown).not.toMatch(/\d{1,2}:\d{2}|etap|rubrik|ocjen|bod/i);
  });

  it("uses no forbidden interface term", () => {
    expect(findForbiddenTerms(JSON.stringify(t))).toEqual([]);
    expect(findForbiddenTerms(text(renderToStaticMarkup(h(MentoredWorks, { works: WORKS }))))).toEqual([]);
  });
});
