import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import { WORK_TYPES, type FacultyRuleVersion, type FacultyRules as Rules } from "@/server/institution/faculty-rules";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import FacultyRules from "./FacultyRules";

// DAN-590 (A-04): invented rule versions only.
const t = messagesHr.facultyRuleVersions;
const workTypes = messagesHr.teacher.assignment.workTypes;

const version = (versionNo: number, over: Partial<FacultyRuleVersion> = {}): FacultyRuleVersion => ({
  versionNo,
  aiPolicy: "prohibited",
  aiPurposes: [],
  evidenceProfile: "basic",
  importAllowed: false,
  origin: "operator",
  publishedAt: "2026-10-01T10:00:00.000Z",
  ...over,
});

const rulesWith = (versions: Partial<Record<(typeof WORK_TYPES)[number], FacultyRuleVersion[]>>): Rules =>
  WORK_TYPES.map((workType) => ({ workType, versions: versions[workType] ?? [] }));

const SOME = rulesWith({
  essay: [
    version(1),
    version(2, {
      aiPolicy: "partially_allowed",
      aiPurposes: ["formatting", "translation"],
      evidenceProfile: "extended",
      importAllowed: true,
      origin: "administrator",
      publishedAt: "2026-11-03T23:30:00.000Z",
    }),
  ],
  master_thesis: [version(1, { aiPolicy: "encouraged" })],
});
const NONE = rulesWith({});
const ALL = rulesWith(Object.fromEntries(WORK_TYPES.map((w) => [w, [version(1)]])));

const render = (rules: Rules) => renderToStaticMarkup(h(FacultyRules, { rules }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const cards = (html: string) => [...html.matchAll(/<article[\s\S]*?<\/article>/g)].map((m) => m[0]);

describe("FacultyRules", () => {
  it("shows one card per work type with a version, in WORK_TYPES order", () => {
    const html = render(SOME);
    const heads = cards(html).map((card) => card.match(/<h3[^>]*>([^<]*)<\/h3>/)![1]);
    expect(heads).toEqual([workTypes.essay, workTypes.master_thesis]);
  });

  it("describes the last version as the one in force, in the Zagreb date", () => {
    const essay = text(cards(render(SOME))[0]!);
    // 23:30 UTC on 3 November is 4 November in Zagreb.
    expect(essay).toContain(t.versionOf.replace("{n}", "2").replace("{date}", "4. studenoga 2026."));
    expect(essay).toContain(t.policies.partially_allowed);
    expect(essay).toContain(`${t.purposeLabels.formatting}, ${t.purposeLabels.translation}`);
    expect(essay).toContain(t.profiles.extended);
    expect(essay).toContain(t.importValues.yes);
    expect(essay).toContain(t.origins.administrator);
  });

  it("lists every version newest first and marks only the one in force", () => {
    const rows = [...cards(render(SOME))[0]!.matchAll(/<tbody>[\s\S]*?<\/tbody>/g)][0]![0];
    const first = [...rows.matchAll(/<tr><td>([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(first).toEqual([t.inForce.replace("{n}", "2"), "1"]);
  });

  it("names no purpose for a version that allows none", () => {
    expect(text(cards(render(SOME))[1]!)).toContain(t.purposesNone);
  });

  it("lists the work types without a rule only beside ones that have one", () => {
    const html = render(SOME);
    expect(html).toContain(t.notSetHeading);
    const listed = [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
    expect(listed).toEqual(WORK_TYPES.filter((w) => w !== "essay" && w !== "master_thesis").map((w) => workTypes[w]));
    expect(render(ALL)).not.toContain(t.notSetHeading);
  });

  it("says that the institution has no rules when no work type has a version", () => {
    const html = render(NONE);
    expect(html).toContain(t.empty);
    expect(html).not.toContain("<article");
    expect(html).not.toContain(t.notSetHeading);
  });

  it("offers no action", () => {
    for (const rules of [SOME, NONE, ALL]) expect(render(rules)).not.toMatch(/<(a|button|form|input)\b/);
  });

  it("uses no forbidden term", () => {
    // Per text node: the date ending the card's meta line and the label "AI
    // pomoć" that opens the list are two elements, and joined they would read
    // as "2026 ai", a share by origin the scanner rightly refuses in one text.
    for (const rules of [SOME, NONE, ALL]) {
      for (const node of render(rules).split(/<[^>]+>/)) expect(findForbiddenTerms(node), node).toEqual([]);
    }
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(t);
    expect(findForbiddenTerms(strings.join(" "))).toEqual([]);
  });
});
