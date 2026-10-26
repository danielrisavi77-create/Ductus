import { describe, expect, it } from "vitest";

import { PROCESS_SUMMARY_FORMAT_V1, type ProcessSummaryV1 } from "./process-summary";
import { processSummaryLines } from "./process-summary-lines";

function summary(over: { items?: ProcessSummaryV1["sessions"]["items"]; listed?: number; smaller?: number }): ProcessSummaryV1 {
  const at = { from: "2026-10-20T10:00:00Z", to: "2026-10-20T10:00:00Z" };
  return {
    summaryFormat: PROCESS_SUMMARY_FORMAT_V1,
    sessions: { evidenceKind: "observed", breakAboveMinutes: 30, count: over.items?.length ?? 0, items: over.items ?? [] },
    pastes: {
      evidenceKind: "observed",
      listedAboveCharacters: 200,
      listed: Array.from({ length: over.listed ?? 0 }, () => ({ at, characters: 250, origin: "not_observed" as const })),
      smallerCount: over.smaller ?? 0,
    },
    gaps: { evidenceKind: "observed", items: [] },
    recordState: "complete",
  };
}

describe("processSummaryLines (B-11c, #757; the student's summary is the source)", () => {
  it("takes the last change from the end of the last session", () => {
    const lines = processSummaryLines(summary({
      items: [
        { from: "2026-10-20T10:00:00Z", to: "2026-10-20T10:20:00Z" },
        { from: "2026-10-21T09:00:00Z", to: "2026-10-21T09:40:00Z" },
      ],
    }));
    expect(lines.lastChangeAt).toBe("2026-10-21T09:40:00Z");
  });

  it("counts every paste with no source given, listed and smaller alike", () => {
    expect(processSummaryLines(summary({ listed: 2, smaller: 3 })).pastesWithoutSource).toBe(5);
  });

  it("gives no last change and no pastes for a record with no session", () => {
    expect(processSummaryLines(summary({}))).toStrictEqual({ lastChangeAt: null, pastesWithoutSource: 0 });
  });
});
