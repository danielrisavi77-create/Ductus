import { describe, expect, it } from "vitest";

import type { WorkContextRead } from "./work-context-read";
import { sheetTitle } from "./sheet-title";

const NEUTRAL = "Bez naslova";

function ready(title: string): WorkContextRead {
  return {
    kind: "ready",
    course: "Izmišljeni kolegij",
    wordRange: null,
    notice: {
      assignmentId: "00000000-0000-4000-8000-000000000001",
      versionNo: 1,
      title,
      instructions: "Izmišljene upute.",
      workType: "seminar",
      evidenceProfile: "basic",
      opensAt: "2026-10-01T08:00:00.000Z",
      dueAt: "2026-11-01T08:00:00.000Z",
      aiPurposes: [],
      wordMin: null,
      wordMax: null,
      acknowledgedAt: "2026-10-02T08:00:00.000Z",
    },
  };
}

describe("sheetTitle (F-8 point 5)", () => {
  it("names the assignment of a ready read", () => {
    expect(sheetTitle(ready("Izmišljeni zadatak o knjižnicama"), NEUTRAL)).toBe("Izmišljeni zadatak o knjižnicama");
  });

  it("trims the surrounding space of the title", () => {
    expect(sheetTitle(ready("  Izmišljeni zadatak  "), NEUTRAL)).toBe("Izmišljeni zadatak");
  });

  it("gives the same neutral text for every read that is not ready (#711 A2)", () => {
    // none covers no ?zadatak=, a foreign, unknown, other-institution or closed
    // assignment and a failed read; noticeFirst redirects before render.
    const reads: WorkContextRead[] = [{ kind: "none" }, { kind: "noticeFirst" }];
    expect(new Set(reads.map((read) => sheetTitle(read, NEUTRAL)))).toEqual(new Set([NEUTRAL]));
  });

  it("falls back to the neutral text for an empty or blank title", () => {
    expect(sheetTitle(ready(""), NEUTRAL)).toBe(NEUTRAL);
    expect(sheetTitle(ready(" \t\n "), NEUTRAL)).toBe(NEUTRAL);
  });

  it("keeps a very long title whole; the heading wraps in CSS", () => {
    const long = `Izmišljeni ${"vrlo dugi naslov zadatka ".repeat(20).trim()}`;
    expect(sheetTitle(ready(long), NEUTRAL)).toBe(long);
  });
});
