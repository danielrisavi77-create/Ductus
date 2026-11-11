import { describe, expect, it } from "vitest";

import {
  PROBLEM_REPORT_DESCRIPTION_MAX,
  PROBLEM_REPORT_ROUTES,
  parseProblemReport,
  problemReportRoute,
} from "./problem-report";

// The input classes of the DAN-431 contract (#1836, c.6788234570), one table per field.
const valid = {
  appVersion: "0.1.0",
  browser: { family: "firefox", major: 132 },
  category: "technical",
  description: "Nakon prijave stranica ostaje prazna.",
  route: "/rad",
  syncState: "SYNCED",
};

function withField(key: string, value: unknown): Record<string, unknown> {
  return { ...valid, [key]: value };
}

const WORK_TEXT = "Uvod. Ovaj rad istražuje utjecaj lokalne samouprave na izlaznost.";

describe("parseProblemReport", () => {
  it("reads a valid report into the closed shape", () => {
    expect(parseProblemReport(valid)).toEqual({
      category: "technical",
      description: valid.description,
      route: "/rad",
      appVersion: "0.1.0",
      browserFamily: "firefox",
      browserMajor: 132,
      syncState: "SYNCED",
    });
  });

  it.each([
    ["category", "technical", true],
    ["category", "account", true],
    ["category", "course", true],
    ["category", "other", false],
    ["category", "Technical", false],
    ["category", null, false],
    ["description", "a", true],
    ["description", "Prvi redak\nDrugi redak\tkraj", true],
    ["description", "ž".repeat(PROBLEM_REPORT_DESCRIPTION_MAX), true],
    ["description", "😀".repeat(PROBLEM_REPORT_DESCRIPTION_MAX), true],
    ["description", "a".repeat(PROBLEM_REPORT_DESCRIPTION_MAX + 1), false],
    ["description", "", false],
    ["description", " \n\t\u00A0\u200B", false],
    ["description", "a\rb", false],
    ["description", "a\u0000b", false],
    ["description", "a\u0085b", false],
    ["description", "a\u202Eb", false],
    ["description", "a\uD800b", false],
    ["description", 5, false],
    ["route", "/", true],
    ["route", "/zadatak/[id]", true],
    ["route", null, true],
    ["route", "/zadatak/3f1c0e6a-0000-4000-8000-000000000001", false],
    ["route", "/rad?naslov=Moj%20rad", false],
    ["route", "/rad#uvod", false],
    ["route", "/rad/", false],
    ["route", WORK_TEXT, false],
    ["route", "", false],
    ["appVersion", "1.2.3", true],
    ["appVersion", "0.0.0+68a05dd", true],
    ["appVersion", "68a05ddd", true],
    ["appVersion", "68a05ddd5f3c9e0e8a1b2c3d4e5f60718293a4b5", true],
    ["appVersion", "1.2.3-rad-o-izborima", false],
    ["appVersion", "1.2", false],
    ["appVersion", "01.2.3", false],
    ["appVersion", "68A05DDD", false],
    ["appVersion", "68a05d", false],
    ["appVersion", WORK_TEXT, false],
    ["syncState", "SYNCED", true],
    ["syncState", "RECOVERY_REQUIRED", true],
    ["syncState", null, true],
    ["syncState", "synced", false],
    ["syncState", "SAVED", false],
    ["browser", { family: "chromium", major: 0 }, true],
    ["browser", { family: "safari", major: 999 }, true],
    ["browser", { family: "other", major: null }, true],
    ["browser", { family: "edge", major: 1 }, false],
    ["browser", { family: "other", major: 1000 }, false],
    ["browser", { family: "other", major: 1.5 }, false],
    ["browser", { family: "other", major: -1 }, false],
    ["browser", { family: "other", major: "120" }, false],
    ["browser", { family: "other" }, false],
    ["browser", { family: "other", major: 1, userAgent: "Mozilla/5.0" }, false],
    ["browser", "Mozilla/5.0 (X11; Linux x86_64) Firefox/132.0", false],
    ["browser", null, false],
  ])("%s = %j is accepted: %s", (key, value, accepted) => {
    expect(parseProblemReport(withField(key, value)) !== null).toBe(accepted);
  });

  it.each(["title", "content", "paragraphs", "journal", "documentId", "userId", "institutionId", "path", "url"])(
    "refuses the extra key %s, whatever it holds",
    (key) => {
      expect(parseProblemReport({ ...valid, [key]: WORK_TEXT })).toBeNull();
      expect(parseProblemReport({ ...valid, [key]: null })).toBeNull();
    },
  );

  it.each(["appVersion", "browser", "category", "description", "route", "syncState"])(
    "refuses a report without %s",
    (key) => {
      const missing: Record<string, unknown> = { ...valid };
      delete missing[key];
      expect(parseProblemReport(missing)).toBeNull();
    },
  );

  it("refuses what is not a plain object", () => {
    for (const value of [null, undefined, "x", 1, [], [valid], Object.assign(Object.create(null), valid)]) {
      expect(parseProblemReport(value)).toBeNull();
    }
  });
});

describe("problemReportRoute", () => {
  it.each([
    ["/", "/"],
    ["/rad", "/rad"],
    ["/rad/", "/rad"],
    ["/rad?naslov=Moj%20rad#uvod", "/rad"],
    ["/zadatak/3f1c0e6a-0000-4000-8000-000000000001", "/zadatak/[id]"],
    ["/nastavnik/rad/abc", "/nastavnik/rad/[id]"],
    ["/nastavnik/zadatak/novi", "/nastavnik/zadatak/novi"],
    ["/nastavnik/zadatak/abc/uredi", "/nastavnik/zadatak/[assignmentId]/uredi"],
    ["/rad/abc/predaja", "/rad/[assignmentId]/predaja"],
    ["/upis/kolegij/k1", "/upis/kolegij/[courseId]"],
    ["/zadatak/", null],
    ["/zadatak//", null],
    ["/nepoznato", null],
    ["rad", null],
    ["", null],
    ["https://ductura.example/rad", null],
  ])("%s gives %s", (path, template) => {
    expect(problemReportRoute(path)).toBe(template);
  });

  it("gives a template that the parser accepts for every listed page", () => {
    for (const route of PROBLEM_REPORT_ROUTES) {
      expect(problemReportRoute(route)).toBe(route);
      expect(parseProblemReport(withField("route", route))).not.toBeNull();
    }
  });
});
