import { describe, expect, it } from "vitest";

import type { SessionPrincipal } from "@/server/auth/principal";
import type { InstitutionOverviewRead } from "@/server/institution/institution-overview";
import type { FacultyRulesRead } from "@/server/institution/faculty-rules";
import type { TeacherRolesRead } from "@/server/institution/teacher-roles";

import { institutionScreen, type InstitutionScreen } from "./institution-access";
import type { CoursesPage } from "./institution-courses-view";

const TOKEN = "T".repeat(43);

type Read = InstitutionOverviewRead["kind"] | null;
type Principal = SessionPrincipal["kind"];

// "closed" is Z-03 with a cookie of the session's shape, the sign-in card without.
const CLOSED = "closed" as const;

// DAN-313 (A-01, #1316 c.6584772547): every read beside every principal. The
// two are read in parallel, so a closed principal beside any read but a
// failed one means the session closed between them; it wins over a refusal.
const TABLE: ReadonlyArray<readonly [Read, Principal, InstitutionScreen | typeof CLOSED]> = [
  ["ok", "signed-in", "allowed"],
  ["ok", "signed-out", CLOSED],
  ["ok", "unverified", "unavailable"],
  ["notFound", "signed-in", "notFound"],
  ["notFound", "signed-out", CLOSED],
  ["notFound", "unverified", "unavailable"],
  ["unavailable", "signed-in", "unavailable"],
  ["unavailable", "signed-out", "unavailable"],
  ["unavailable", "unverified", "unavailable"],
  ["unauthorized", "signed-in", CLOSED],
  ["unauthorized", "signed-out", CLOSED],
  ["unauthorized", "unverified", CLOSED],
  [null, "signed-in", CLOSED],
  [null, "signed-out", CLOSED],
  [null, "unverified", CLOSED],
];

describe("institutionScreen", () => {
  it.each(TABLE)("read %s beside principal %s gives %s", (read, principal, want) => {
    if (want === CLOSED) {
      expect(institutionScreen(read, principal, TOKEN)).toBe("expired");
      expect(institutionScreen(read, principal, "kratko")).toBe("signedOut");
      expect(institutionScreen(read, principal, undefined)).toBe("signedOut");
    } else {
      for (const token of [TOKEN, "kratko", undefined]) {
        expect(institutionScreen(read, principal, token)).toBe(want);
      }
    }
  });

  it("covers every read and principal", () => {
    const reads: Read[] = ["ok", "notFound", "unavailable", "unauthorized", null];
    const principals: Principal[] = ["signed-in", "signed-out", "unverified"];
    const keys = new Set(TABLE.map(([r, p]) => `${r}/${p}`));
    expect(keys.size).toBe(TABLE.length);
    for (const r of reads) for (const p of principals) expect(keys.has(`${r}/${p}`)).toBe(true);
  });

  it("never answers a session that closed between the reads with a 404", () => {
    expect(institutionScreen("notFound", "signed-out", TOKEN)).toBe("expired");
  });

  it("shows the counts only to a signed-in administrator", () => {
    expect(institutionScreen("ok", "signed-in", TOKEN)).toBe("allowed");
  });
});

// DAN-581 PR 3 (A-02, contract #1091 c.6677177709): /ustanova/korisnici takes
// its screen from the teacher roles read, whose answers are the same four.
describe("institutionScreen for the teacher roles read", () => {
  type RolesRead = TeacherRolesRead["kind"] | null;
  const kinds: Record<TeacherRolesRead["kind"], true> = { ok: true, unauthorized: true, notFound: true, unavailable: true };

  it("has a row in the table above for every answer of the teacher roles read", () => {
    const reads = new Set<RolesRead>(TABLE.map(([read]) => read));
    for (const kind of Object.keys(kinds) as TeacherRolesRead["kind"][]) expect(reads.has(kind)).toBe(true);
  });

  it("shows no list when the session closed after the lists were read", () => {
    expect(institutionScreen("ok", "signed-out", TOKEN)).toBe("expired");
    expect(institutionScreen("ok", "signed-out", undefined)).toBe("signedOut");
  });
});

// DAN-590 (A-04, contract #1091 c.6695058963): /ustanova/pravila takes its
// screen from the faculty rules read, whose answers are the same four.
describe("institutionScreen for the faculty rules read", () => {
  type RulesRead = FacultyRulesRead["kind"] | null;
  const kinds: Record<FacultyRulesRead["kind"], true> = { ok: true, unauthorized: true, notFound: true, unavailable: true };

  it("has a row in the table above for every answer of the faculty rules read", () => {
    const reads = new Set<RulesRead>(TABLE.map(([read]) => read));
    for (const kind of Object.keys(kinds) as FacultyRulesRead["kind"][]) expect(reads.has(kind)).toBe(true);
  });

  it("hides the page from a caller who is not the administrator", () => {
    expect(institutionScreen("notFound", "signed-in", TOKEN)).toBe("notFound");
  });
});

// DAN-591 (A-03, contract #1091 c.6708627828): /ustanova/kolegiji takes its
// screen from coursesPage, whose answers are the same four
// (institution-courses-view.test.ts has every pair of its two reads).
describe("institutionScreen for the courses page", () => {
  const kinds: Record<CoursesPage["kind"], true> = { ok: true, unauthorized: true, notFound: true, unavailable: true };

  it("has a row in the table above for every answer of the courses page", () => {
    const reads = new Set<Read | CoursesPage["kind"]>(TABLE.map(([read]) => read));
    for (const kind of Object.keys(kinds) as CoursesPage["kind"][]) expect(reads.has(kind)).toBe(true);
  });
});
