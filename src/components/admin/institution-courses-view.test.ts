import { describe, expect, it } from "vitest";

import type { AcademicYearsRead, InstitutionCoursesRead } from "@/server/institution/institution-courses";

import { institutionScreen } from "./institution-access";
import { chosenYear, coursesPage, yearHref, yearLabel, yearParam } from "./institution-courses-view";

// DAN-591 (A-03; contract #1091 c.6708627828, plan #1688). Invented years only.
const YEARS = ["2026/2027", "2025/2026"];
const TOKEN = "a".repeat(43);

describe("chosenYear over every class of ?godina=", () => {
  const CLASSES: [string, string | string[] | undefined, string | null][] = [
    ["absent", undefined, "2026/2027"],
    ["empty", "", "2026/2027"],
    ["repeated", ["2025/2026", "2025/2026"], "2026/2027"],
    ["dash form", "2026-2027", "2026/2027"],
    ["years apart", "2026/2028", "2026/2027"],
    ["reversed", "2027/2026", "2026/2027"],
    ["markup", "<b>2025/2026</b>", "2026/2027"],
    ["long", "2025/2026".repeat(500), "2026/2027"],
    ["control character", "2025/2026\u0000", "2026/2027"],
    ["padded", " 2025/2026", "2026/2027"],
    ["well formed, not the institution's", "2030/2031", "2026/2027"],
    ["older own year", "2025/2026", "2025/2026"],
    ["newest own year", "2026/2027", "2026/2027"],
  ];

  it.each(CLASSES)("%s", (_name, raw, expected) => {
    expect(chosenYear(YEARS, yearParam(raw))).toBe(expected);
  });

  it("reads no year for an institution without courses, whatever is asked", () => {
    for (const [, raw] of CLASSES) expect(chosenYear([], yearParam(raw))).toBeNull();
  });
});

describe("coursesPage and institutionScreen over every pair of reads", () => {
  type Years = AcademicYearsRead | null;
  const yearsReads: [string, Years][] = [
    ["no cookie", null],
    ["years unauthorized", { kind: "unauthorized" }],
    ["years notFound", { kind: "notFound" }],
    ["years unavailable", { kind: "unavailable" }],
    ["no years", { kind: "ok", years: [] }],
    ["years", { kind: "ok", years: YEARS }],
  ];
  const coursesReads: [string, InstitutionCoursesRead][] = [
    ["courses unauthorized", { kind: "unauthorized" }],
    ["courses notFound", { kind: "notFound" }],
    ["courses invalid", { kind: "invalid" }],
    ["courses unavailable", { kind: "unavailable" }],
    ["no courses", { kind: "ok", academicYear: "2026/2027", courses: [] }],
    ["courses", { kind: "ok", academicYear: "2026/2027", courses: [
      { courseId: "00000000-0000-4000-8000-000000000001", name: "Izmišljeni kolegij", students: 3, holder: null, team: [], groups: [] },
    ] }],
  ];
  const principals = ["signed-in", "unverified", "signed-out"] as const;

  // What the page shows, from the two reads alone, for a signed-in principal.
  function expected(years: Years, courses: InstitutionCoursesRead): string {
    if (years === null) return "signedOut";
    if (years.kind === "unauthorized") return "expired";
    if (years.kind === "unavailable") return "unavailable";
    if (years.kind !== "ok") return "notFound";
    if (years.years.length === 0) return "allowed";
    if (courses.kind === "unauthorized") return "expired";
    if (courses.kind === "notFound") return "notFound";
    if (courses.kind === "ok") return "allowed";
    return "unavailable";
  }

  for (const [yName, years] of yearsReads) {
    for (const [cName, courses] of coursesReads) {
      for (const principal of principals) {
        it(`${yName} · ${cName} · ${principal}`, () => {
          const token = years === null ? undefined : TOKEN;
          const page = years === null ? null : coursesPage(years, courses);
          const screen = institutionScreen(page?.kind ?? null, principal, token);
          const signedIn = expected(years, courses);
          // A principal that is not signed in never sees the list or the 404.
          const want = principal === "signed-in" || ["signedOut", "expired", "unavailable"].includes(signedIn)
            ? signedIn
            : principal === "unverified" ? "unavailable" : "expired";
          expect(screen).toBe(want);
          // A list only after two successful reads.
          if (screen === "allowed") expect(page?.kind).toBe("ok");
        });
      }
    }
  }
});

describe("Istodobnost: the session or the role changes between the two reads", () => {
  const years: AcademicYearsRead = { kind: "ok", years: YEARS };

  it("shows the card, never a list, when the session closed after the years were read", () => {
    const page = coursesPage(years, { kind: "unauthorized" });
    expect(page.kind).toBe("unauthorized");
    expect(institutionScreen(page.kind, "signed-in", TOKEN)).toBe("expired");
  });

  it("hides the page, never an empty year, when the role was revoked after the years were read", () => {
    const page = coursesPage(years, { kind: "notFound" });
    expect(page.kind).toBe("notFound");
    expect(institutionScreen(page.kind, "signed-in", TOKEN)).toBe("notFound");
  });

  it("cannot read, rather than show an empty year, when the courses read is missing or answers another year", () => {
    expect(coursesPage(years, null).kind).toBe("unavailable");
    expect(coursesPage(years, { kind: "ok", academicYear: "2030/2031", courses: [] }).kind).toBe("unavailable");
  });
});

describe("year label and address", () => {
  it("writes the year with ordinal dots and encodes the slash", () => {
    expect(yearLabel("2026/2027")).toBe("2026./2027.");
    expect(yearHref("/ustanova/kolegiji", "2025/2026")).toBe("/ustanova/kolegiji?godina=2025%2F2026");
  });
});
