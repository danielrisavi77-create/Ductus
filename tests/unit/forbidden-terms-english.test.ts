import { describe, expect, it } from "vitest";

import { findForbiddenTerms } from "../../scripts/forbidden-terms/terms";

// docs/PRODUCT.md 5, "Dodatni engleski popis" (D-276, NQ12): rows for the English
// interface (D-70) that the table above it does not already hold.
const SCORE = "trust score, attention score";
const JUDGEMENT = "cheating, dishonest, misconduct";
const DETECTED = "AI-detected, flagged as AI";
const FLAGGED = "flagged, flagged for review";

const entries = (text: string) => findForbiddenTerms(text).map((term) => term.entry);
const english = (text: string) => findForbiddenTerms(text, "en").map((term) => term.entry);

describe("additional English list (D-276)", () => {
  it.each([
    ["Trust score", SCORE],
    ["Trust scores per student", SCORE],
    ["Attention score: 4", SCORE],
    ["Attention-score", SCORE],
    ["Trust scoring", SCORE],
    ["Cheating", JUDGEMENT],
    ["Cheated on the essay", JUDGEMENT],
    ["Possible cheater", JUDGEMENT],
    ["Cheats", JUDGEMENT],
    ["Dishonest work", JUDGEMENT],
    ["Academic dishonesty", JUDGEMENT],
    ["Dishonestly written", JUDGEMENT],
    ["Misconduct", JUDGEMENT],
    ["Academic misconduct report", JUDGEMENT],
    ["AI-detected", DETECTED],
    ["AI detected in paragraph 3", DETECTED],
    ["AI detection", DETECTED],
    ["AI detector", DETECTED],
    ["Detected as AI", DETECTED],
    ["Detected by AI", DETECTED],
    ["Flagged as AI", DETECTED],
    ["Flagged as artificial intelligence", DETECTED],
    ["Flag as AI", DETECTED],
    ["Detected by A.I.", DETECTED],
    ["A.I. detection", DETECTED],
    ["Flagged", FLAGGED],
    ["Flagged for review", FLAGGED],
    ["Flagging", FLAGGED],
    ["Unflagged works", FLAGGED],
    ["Flag for review", FLAGGED],
    ["Flag this student", FLAGGED],
    ["Flag the submission", FLAGGED],
    ["Flags for the work", FLAGGED],
    ["Red flag", FLAGGED],
    ["Red flags in the text", FLAGGED],
    // Review and QA on 8c4bb3b8: a prefix on the verb, and words between the verb and the work.
    ["Reflagged submission", FLAGGED],
    ["Reflagged for review", FLAGGED],
    ["Reflagging", FLAGGED],
    ["Unflag this student", FLAGGED],
    ["Reflag", FLAGGED],
    ["Auto-flagged", FLAGGED],
    ["Flag selected submission for review", FLAGGED],
    ["Flag the selected submissions", FLAGGED],
    ["Flag all late student works", FLAGGED],
    ["Flags their paper", FLAGGED],
  ])("flags %j as %s", (text, entry) => {
    expect(entries(text)).toContain(entry);
    expect(english(text)).toContain(entry);
  });

  it("keeps the rows of the table that already held a form of the list", () => {
    expect(entries("Risk score")).toEqual(["risk"]);
    expect(entries("Suspicion score")).toEqual(["suspicious"]);
  });

  it.each([
    "Score",
    "Trust",
    "Trustworthy source",
    "Attention",
    "Needs your attention",
    "Pay attention to the deadline",
    "Detected",
    "Offline mode detected",
    "Language detection",
    "Flag",
    "Language flag icon",
    "Feature flags",
    "Flag colours of the course",
    "Language flag next to the title",
    "Flagship course",
    "Flagship AI course",
    "Honest feedback",
    "Code of conduct",
    "Cheap",
    "Checked",
    "Detected changes since the last version",
    "From the AI assistant (model, 14:05)",
  ])("allows %j", (text) => {
    expect(entries(text)).toEqual([]);
  });

  it("are English rows that no Croatian text matches", () => {
    for (const text of ["Ocjena povjerenja", "Varanje", "Nepošten rad", "Označeno za pregled", "Zastavica"]) {
      expect(english(text)).toEqual([]);
    }
    expect(findForbiddenTerms("Flagged, cheating, trust score, AI-detected", "hr")).toEqual([]);
  });
});
