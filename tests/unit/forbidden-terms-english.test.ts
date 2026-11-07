import { describe, expect, it } from "vitest";

import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { FORBIDDEN_TERMS, findForbiddenTerms } from "../../scripts/forbidden-terms/terms";

// docs/PRODUCT.md 5, "Dodatni engleski popis" (D-276, NQ12): rows for the English
// interface (D-70) that the table above it does not already hold. Owner decision of
// 7. 11. 2026. ("Promijeni pristup"): the rows read roots inside tokens, not phrases.
const SCORE = "trust score, attention score";
const JUDGEMENT = "cheating, dishonest, misconduct";
const DETECTED = "AI-detected, flagged as AI";
const FLAGGED = "flagged, flagged for review";
const D276 = [SCORE, JUDGEMENT, DETECTED, FLAGGED];

const entries = (text: string) => findForbiddenTerms(text).map((term) => term.entry);
const english = (text: string) => findForbiddenTerms(text, "en").map((term) => term.entry);
const d276 = (text: string) => entries(text).filter((entry) => D276.includes(entry));

describe("additional English list (D-276)", () => {
  it("has one row for every line of the list", () => {
    expect(FORBIDDEN_TERMS.filter((term) => D276.includes(term.entry)).map((term) => term.lang)).toEqual(["en", "en", "en", "en"]);
  });

  it.each([
    // Every form named in the review and QA FAILs of 8c4bb3b8 and 93771f5f.
    ["Reflagged submission", FLAGGED],
    ["Unflag this student", FLAGGED],
    ["Flag selected submission for review", FLAGGED],
    ["Flag 2 submissions", FLAGGED],
    ["Trust-scored submissions", SCORE],
    // The same forms as identifiers, words run together and other separators.
    ["reFlaggedSubmission", FLAGGED],
    ["unflag_this_student", FLAGGED],
    ["FLAG-2-SUBMISSIONS", FLAGGED],
    ["trustScoredSubmissions", SCORE],
    ["trust_scored", SCORE],
    ["Trust/scored", SCORE],
    ["Trust​score", SCORE],
    ["Ｔｒｕｓｔ ｓｃｏｒｅ", SCORE],
    // The rest of the list.
    ["Trust score", SCORE],
    ["Trust scores per student", SCORE],
    ["Attention score: 4", SCORE],
    ["Attention-score", SCORE],
    ["Trust scoring", SCORE],
    ["Trust 3 score", SCORE],
    ["Score of trust", SCORE],
    ["Cheating", JUDGEMENT],
    ["Cheated on the essay", JUDGEMENT],
    ["Possible cheater", JUDGEMENT],
    ["Uncheatable", JUDGEMENT],
    ["Dishonest work", JUDGEMENT],
    ["Academic dishonesty", JUDGEMENT],
    ["Misconduct", JUDGEMENT],
    ["Academic misconduct report", JUDGEMENT],
    ["AI-detected", DETECTED],
    ["AI detected in paragraph 3", DETECTED],
    ["AI detection", DETECTED],
    ["aiDetected", DETECTED],
    ["isAiDetected", DETECTED],
    ["Detected as AI", DETECTED],
    ["Detected by A.I.", DETECTED],
    ["Flagged as AI", DETECTED],
    ["Flagged as artificial intelligence", DETECTED],
    ["Flagged", FLAGGED],
    ["Flagged for review", FLAGGED],
    ["Auto-flagged", FLAGGED],
    ["Red flags in the text", FLAGGED],
    ["Flags their paper", FLAGGED],
    // Fail closed: a root is reported wherever it stands, not only next to a work or a student.
    ["Flag", FLAGGED],
    ["Language flag icon", FLAGGED],
    ["Flagship course", FLAGGED],
    ["Feature flags flagged this work", FLAGGED],
    ["Feature flagship", FLAGGED],
    // Contract confirmation c.6711708837, 1: a root broken by a mark or a space is read across the tokens.
    ["Dis-honest work", JUDGEMENT],
    ["Fl ag this submission", FLAGGED],
    ["che_at", JUDGEMENT],
    ["mis/conduct", JUDGEMENT],
    ["Tr ust sc ore", SCORE],
    ["A I de-tected", DETECTED],
    // Contract confirmation c.6711708837, 2: a letter of another script that looks Latin.
    ["Flаg this submission", FLAGGED],
    ["Сheating", JUDGEMENT],
    ["Truѕt scоre", SCORE],
    ["АI detected", DETECTED],
    ["Flαgged", FLAGGED],
    ["miscοnduct", JUDGEMENT],
  ])("reports %j as %s", (text, entry) => {
    expect(entries(text)).toContain(entry);
    expect(english(text)).toContain(entry);
  });

  it("keeps risk score and suspicion score on the rows of the table that already held them", () => {
    expect(entries("Risk score")).toEqual(["risk"]);
    expect(entries("Lowriskscore")).toEqual(["risk"]);
    expect(entries("Suspicion score")).toEqual(["suspicious"]);
    expect(entries("Suspicion-scored")).toEqual(["suspicious"]);
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
    "Detected changes since the last version",
    "From the AI assistant (model, 14:05)",
    "Aid detected",
    "Honest feedback",
    "Code of conduct",
    "Cheap",
    "Checked",
    // The only exception: a software feature switch, as tokens.
    "Feature flags",
    "Feature flag",
    "featureFlags",
    "feature_flag",
    "FEATURE-FLAGS",
  ])("allows %j", (text) => {
    expect(entries(text)).toEqual([]);
  });

  it("are English rows that no Croatian text matches", () => {
    for (const text of ["Ocjena povjerenja", "Varanje", "Nepošten rad", "Označeno za pregled", "Zastavica"]) {
      expect(english(text)).toEqual([]);
    }
    expect(findForbiddenTerms("Flagged, cheating, trust score, AI-detected", "hr")).toEqual([]);
  });

  it("leaves every string of the Croatian catalogue alone", () => {
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(messagesHr);
    expect(strings.length).toBeGreaterThan(100);
    expect(strings.filter((text) => d276(text).length > 0)).toEqual([]);
  });
});
