import { describe, expect, it } from "vitest";

import type { WorkContextRead } from "./work-context-read";
import { workHeader } from "./work-header";

// Invented course and assignment (CLAUDE.md: no real data).
function ready(course: string, dueAt: string): WorkContextRead {
  return {
    kind: "ready",
    course,
    courseId: null,
    notice: { title: "Izmišljeni zadatak", dueAt } as never,
    wordRange: null,
  };
}

describe("work header of /rad (Archivum S04)", () => {
  it("names the course and the deadline in Zagreb time for the student's own assignment", () => {
    expect(workHeader(ready("Izmišljeni kolegij", "2026-11-13T22:59:00Z"))).toEqual({
      eyebrow: "Izmišljeni kolegij",
      meta: "Rok: 13. studenoga 2026. u 23:59",
    });
  });

  it("shows neither without a ready read, so no case is told apart (#711 A2)", () => {
    expect(workHeader(null)).toEqual({ eyebrow: null, meta: null });
    for (const kind of ["none", "noticeFirst"] as const) {
      expect(workHeader({ kind } as WorkContextRead)).toEqual({ eyebrow: null, meta: null });
    }
  });

  it("leaves out an empty course and an unreadable deadline instead of inventing them", () => {
    expect(workHeader(ready("  ", "not a time"))).toEqual({ eyebrow: null, meta: null });
  });
});
