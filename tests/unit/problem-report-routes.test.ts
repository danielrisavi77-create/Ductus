import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BROWSER_FAMILIES,
  PROBLEM_REPORT_CATEGORIES,
  PROBLEM_REPORT_DESCRIPTION_MAX,
  PROBLEM_REPORT_ROUTES,
  isAppVersion,
  isProblemDescription,
  problemReportRoute,
} from "@/domain/support/problem-report";
import { SYNC_STATES } from "@/domain/sync/states";

// DAN-431: the migration's CHECKs and the domain module are one contract; a
// value one accepts and the other refuses is a report lost or a class widened.
const ROOT = join(import.meta.dirname, "..", "..");
const MIGRATION = readFileSync(join(ROOT, "db/migrations/20261112110000_problem_report.sql"), "utf8");
const UP = MIGRATION.slice(0, MIGRATION.indexOf("-- migrate:down"));

/** The quoted members of `column ... IN (...)` in the table's CHECK. */
function checkSet(column: string): string[] {
  const match = new RegExp(`\\n  ${column} text[^\\n]*CHECK \\(${column} IN \\(([^)]*)\\)`, "s").exec(UP);
  if (!match?.[1]) throw new Error(`no CHECK set for ${column}`);
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");
}

describe("DAN-431 problem report: migration and domain agree", () => {
  it("every closed set is the same in both", () => {
    expect(checkSet("route")).toEqual([...PROBLEM_REPORT_ROUTES]);
    expect(checkSet("category")).toEqual([...PROBLEM_REPORT_CATEGORIES]);
    expect(checkSet("browser_family")).toEqual([...BROWSER_FAMILIES]);
    expect(checkSet("sync_state")).toEqual([...SYNC_STATES]);
  });

  it("the description length, the app version pattern and the character classes are the same", () => {
    expect(UP).toContain(`char_length(description) BETWEEN 1 AND ${PROBLEM_REPORT_DESCRIPTION_MAX}`);
    const source = readFileSync(join(ROOT, "src/domain/support/problem-report.ts"), "utf8");
    const tsVersion = /const APP_VERSION = \/(.*)\/;/.exec(source)?.[1];
    expect(tsVersion).toBeDefined();
    expect(UP).toContain(`app_version ~ '${tsVersion}'`);
    const tsVisible = /const VISIBLE =\s*\/(\[\^[^\]]*\])\/u;/.exec(source)?.[1];
    expect(tsVisible).toBeDefined();
    expect(UP).toContain(`description ~ '${tsVisible}'`);
    const tsBidi = /const BIDI = \/\[([^\]]*)\]\/u;/.exec(source)?.[1];
    expect(tsBidi).toBeDefined();
    expect(UP).toMatch(new RegExp(`description !~ '\\[[^\\]]*${tsBidi?.replace(/\\/g, "\\\\")}\\]'`));
  });

  it("the shared limits hold at their edges in the domain", () => {
    expect(isProblemDescription("x".repeat(PROBLEM_REPORT_DESCRIPTION_MAX))).toBe(true);
    expect(isProblemDescription("x".repeat(PROBLEM_REPORT_DESCRIPTION_MAX + 1))).toBe(false);
    expect(isAppVersion("9999.9999.9999+" + "f".repeat(40))).toBe(true);
    expect(isAppVersion("10000.0.0")).toBe(false);
  });
});

describe("DAN-431 problem report: route templates are real pages", () => {
  it.each(PROBLEM_REPORT_ROUTES)("%s has an app page", (route) => {
    const page = route === "/" ? "app/page.tsx" : `app${route}/page.tsx`;
    expect(existsSync(join(ROOT, page))).toBe(true);
  });

  it.each(PROBLEM_REPORT_ROUTES)("%s maps back to itself", (route) => {
    expect(problemReportRoute(route)).toBe(route);
  });
});
