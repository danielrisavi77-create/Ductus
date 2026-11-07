import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import { teacherRoleOutcomeText, type TeacherRoleAction, type TeacherRoleOutcome } from "./teacher-role-action";

// DAN-581 (A-02): the copy of the reference, free of every forbidden term
// (PRODUCT §5), and one line for every outcome of each action.
const t = messagesHr.teacherRoles;
const KINDS: TeacherRoleOutcome["kind"][] = [
  "confirmed", "revoked", "notConfirmed", "notCandidate", "unauthorized", "forbidden", "invalid", "unknown",
];
const ACTIONS: TeacherRoleAction[] = ["confirm", "revoke"];

const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Object.values(value as object).flatMap(strings);

describe("A-02 copy", () => {
  it("has no forbidden term anywhere in the block", () => {
    const all = strings(t);
    expect(all.length).toBeGreaterThan(30);
    for (const text of all) expect(findForbiddenTerms(text), text).toEqual([]);
  });

  it("names P7 as a mark for review, never as a revocation (D-200 P7)", () => {
    expect(t.review.mark).toBe("Za pregled");
    expect(t.review.note).toContain("Uloga nije opozvana");
  });

  it("says both actions are written to the audit trail", () => {
    expect(t.confirmDialog.points.at(-1)).toContain("revizijski trag");
    expect(t.revokeDialog.points.at(-1)).toContain("revizijski trag");
  });

  it("gives every outcome of each action a line, and an unknown outcome claims neither way", () => {
    for (const action of ACTIONS) {
      for (const kind of KINDS) expect(teacherRoleOutcomeText(action, kind)).toMatch(/\S/);
      expect(teacherRoleOutcomeText(action, "unknown")).toMatch(/^Ishod nije poznat\./);
    }
    expect(teacherRoleOutcomeText("confirm", "unknown")).toContain("je li uloga potvrđena");
    expect(teacherRoleOutcomeText("revoke", "unknown")).toContain("je li uloga opozvana");
  });

  it("never shows a refused or a no-op revocation as done", () => {
    const done = new Set([t.outcome.confirmed, t.outcome.revoked]);
    for (const action of ACTIONS) {
      for (const kind of KINDS.filter((k) => k !== "confirmed" && k !== "revoked")) {
        expect(done.has(teacherRoleOutcomeText(action, kind))).toBe(false);
      }
    }
    expect(teacherRoleOutcomeText("revoke", "notConfirmed")).toBe(t.outcome.notConfirmed);
  });
});
