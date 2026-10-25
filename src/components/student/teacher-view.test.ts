import { describe, expect, it } from "vitest";

import { LOCAL_DEMO_DOCUMENT_ID } from "@/lib/journal/local-scope";

import { radPath, teacherViewMode } from "./teacher-view";
import type { WorkDocumentPlan } from "./work-document-plan";

// #732 item 7 (contract 6396547184 §6 unit 1 and 3). Invented ids only.
const ASSIGNMENT = "7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const OFF = { comments: false, live: false, submission: false } as const;
const journal = { scope: "izmisljeni-opseg", documentId: "izmisljeni-dokument" };

const own: WorkDocumentPlan = {
  kind: "assignment", journal, assignmentId: ASSIGNMENT, dueAt: "2026-12-01T10:00:00.000Z",
  comments: true, live: true, submission: true,
};
const others: [string, WorkDocumentPlan][] = [
  ["free", { kind: "free", journal: { scope: "izmisljeni-opseg", documentId: LOCAL_DEMO_DOCUMENT_ID }, ...OFF }],
  ["opening", { kind: "opening", journal: null, assignmentId: ASSIGNMENT, ...OFF }],
  ["notYetOpen", { kind: "notYetOpen", journal: null, opensAt: "2026-12-01T10:00:00.000Z", ...OFF }],
  // A teacher on /rad?zadatak= gets this plan too (F1a).
  ["unavailable", { kind: "unavailable", journal: null, ...OFF }],
  ["localDemo", { kind: "localDemo", journal: { scope: "lokalno", documentId: LOCAL_DEMO_DOCUMENT_ID }, ...OFF }],
  ["localDemo without a journal", { kind: "localDemo", journal: null, ...OFF }],
  ["signInAgain", { kind: "signInAgain", journal: null, ...OFF }],
];

describe("teacherViewMode", () => {
  it("links the student's own work of an assignment to its teacher's view", () => {
    expect(teacherViewMode(own, undefined)).toEqual({
      mode: "writing", teacherViewHref: `/rad?zadatak=${ASSIGNMENT}&prikaz=nastavnik`,
    });
    expect(teacherViewMode(own, "nastavnik")).toEqual({
      mode: "teacher-view", teacherViewHref: `/rad?zadatak=${ASSIGNMENT}&prikaz=nastavnik`,
    });
  });

  it.each(others)("gives %s no teacher's view, with or without prikaz=nastavnik", (_name, plan) => {
    for (const prikaz of [undefined, "nastavnik", ["nastavnik"]]) {
      expect(teacherViewMode(plan, prikaz)).toEqual({ mode: "writing", teacherViewHref: undefined });
    }
  });

  it.each([["Nastavnik"], ["NASTAVNIK"], ["nastavnik "], [" nastavnik"], [""], ["student"], ["nastavnik&x"]])(
    "reads prikaz=%j as the writing view: only exactly 'nastavnik' opens it",
    (prikaz) => {
      expect(teacherViewMode(own, prikaz).mode).toBe("writing");
    },
  );

  it("reads a repeated prikaz as the writing view", () => {
    expect(teacherViewMode(own, ["nastavnik", "nastavnik"]).mode).toBe("writing");
    expect(teacherViewMode(own, ["nastavnik"]).mode).toBe("writing");
  });
});

describe("radPath", () => {
  it("is /rad, the assignment's writing view or its teacher's view", () => {
    expect(radPath(null)).toBe("/rad");
    expect(radPath(null, true)).toBe("/rad");
    expect(radPath(ASSIGNMENT)).toBe(`/rad?zadatak=${ASSIGNMENT}`);
    expect(radPath(ASSIGNMENT, true)).toBe(`/rad?zadatak=${ASSIGNMENT}&prikaz=nastavnik`);
  });

  it("encodes the id", () => {
    expect(radPath("a&prikaz=x#y")).toBe("/rad?zadatak=a%26prikaz%3Dx%23y");
  });
});
