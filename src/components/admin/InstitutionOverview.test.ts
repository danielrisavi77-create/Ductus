import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { messagesHr } from "@/lib/i18n/messages.hr";
import type { InstitutionOverview as Overview } from "@/server/institution/institution-overview";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import InstitutionOverview from "./InstitutionOverview";

// An invented institution and invented counts only.
const t = messagesHr.institutionOverview;
const OVERVIEW: Overview = {
  institutionName: "Fakultet A (test)",
  confirmedTeachers: 4,
  teacherCandidates: 2,
  teachersWithoutAffiliation: 1,
  courses: 3,
  students: 1250,
};
const render = (overview: Overview) => renderToStaticMarkup(h(InstitutionOverview, { overview }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("InstitutionOverview", () => {
  it("shows the name and each count beside what it counts, in a fixed order", () => {
    const html = render(OVERVIEW);
    expect(html).toContain("Fakultet A (test)");
    const values = [...html.matchAll(/<dd class="[^"]*value[^"]*">([^<]*)<\/dd>/g)].map((m) => m[1]);
    expect(values).toEqual(["4", "2", "1", "3", "1.250"]);
    for (const key of Object.keys(t.counts) as (keyof typeof t.counts)[]) {
      expect(html).toContain(t.counts[key].label);
    }
  });

  it("names an institution without a display name as such", () => {
    expect(render({ ...OVERVIEW, institutionName: null })).toContain(t.unnamed);
  });

  it("offers no action", () => {
    const html = render(OVERVIEW);
    expect(html).not.toMatch(/<(a|button|form)\b/);
  });

  it("uses no forbidden term", () => {
    expect(findForbiddenTerms(text(render(OVERVIEW)))).toEqual([]);
    expect(findForbiddenTerms(text(render({ ...OVERVIEW, institutionName: null })))).toEqual([]);
    expect(findForbiddenTerms(`${t.title} ${t.lead} ${t.unavailable} ${t.retry}`)).toEqual([]);
  });
});
