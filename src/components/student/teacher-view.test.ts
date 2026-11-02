import { describe, expect, it } from "vitest";

import { teacherViewMode } from "./teacher-view";
import type { PlanJournal, WorkDocumentPlan } from "./work-document-plan";

// #732 item 7 (contract 6396547184 §6 unit 1). Every id below is invented.
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOURNAL: PlanJournal = { scope: "e".repeat(64), documentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
const OFF = { comments: false, live: false, submission: false } as const;
const ASSIGNMENT: WorkDocumentPlan = {
  kind: "assignment", journal: JOURNAL, assignmentId: ID, dueAt: "2026-11-30T22:59:00.000Z",
  comments: true, live: true, submission: true,
};
const HREF = `/rad?zadatak=${ID}&prikaz=nastavnik`;

describe("teacherViewMode", () => {
  it("links the student's own assignment work to its teacher's view", () => {
    expect(teacherViewMode(ASSIGNMENT, undefined)).toEqual({ mode: "writing", teacherViewHref: HREF });
    expect(teacherViewMode(ASSIGNMENT, "nastavnik")).toEqual({ mode: "teacher-view", teacherViewHref: HREF });
  });

  it.each<[string, string | string[]]>([
    ["capitalised", "Nastavnik"],
    ["upper case", "NASTAVNIK"],
    ["with a trailing space", "nastavnik "],
    ["empty", ""],
    ["another view", "pisanje"],
    ["given twice", ["nastavnik", "nastavnik"]],
  ])("stays in writing when prikaz is %s", (_name, prikaz) => {
    expect(teacherViewMode(ASSIGNMENT, prikaz)).toEqual({ mode: "writing", teacherViewHref: HREF });
  });

  it.each<[string, WorkDocumentPlan]>([
    ["free", { kind: "free", journal: JOURNAL, ...OFF }],
    // DAN-330 (#830): the plan before the student's click; it replaced "opening".
    ["notStarted", { kind: "notStarted", journal: null, assignmentId: ID, dueAt: "2026-11-30T22:59:00.000Z", ...OFF }],
    ["notYetOpen", { kind: "notYetOpen", journal: null, opensAt: "2026-11-02T08:00:00.000Z", ...OFF }],
    ["unavailable", { kind: "unavailable", journal: null, ...OFF }],
    ["localDemo", { kind: "localDemo", journal: JOURNAL, ...OFF }],
    ["signInAgain", { kind: "signInAgain", journal: null, ...OFF }],
  ])("gives %s no teacher's view, whatever prikaz says", (_name, plan) => {
    for (const prikaz of [undefined, "nastavnik"]) {
      expect(teacherViewMode(plan, prikaz)).toEqual({ mode: "writing", teacherViewHref: undefined });
    }
  });

  it("encodes the assignment id in the link", () => {
    const odd = { ...ASSIGNMENT, assignmentId: "a&b c" } as WorkDocumentPlan;
    expect(teacherViewMode(odd, undefined).teacherViewHref).toBe("/rad?zadatak=a%26b%20c&prikaz=nastavnik");
  });
});
