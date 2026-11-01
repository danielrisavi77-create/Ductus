import { describe, expect, it } from "vitest";

import { closedSessionKind, coursesAccess, teacherPageAccess } from "./access-kind";

const SESSION = "A".repeat(43);

// DAN-378 (M1.8): which access screen a page shows.
describe("closedSessionKind", () => {
  it("says expired only when a session-shaped cookie is still there (Z-03)", () => {
    expect(closedSessionKind(SESSION)).toBe("expired");
  });

  it("never says expired to someone without a session (#1234)", () => {
    for (const token of [undefined, "", "kratko", `${SESSION}!`, "A".repeat(44)]) {
      expect(closedSessionKind(token), String(token)).toBe("signedOut");
    }
  });
});

describe("teacherPageAccess", () => {
  it("keeps an allowed and an unavailable check as they are", () => {
    for (const principal of ["signed-in", "signed-out", "unverified"] as const) {
      expect(teacherPageAccess("allowed", principal, SESSION)).toBe("allowed");
      expect(teacherPageAccess("unavailable", principal, SESSION)).toBe("unavailable");
    }
  });

  it("shows Z-05 only to a signed-in person without the role (#1233)", () => {
    expect(teacherPageAccess("denied", "signed-in", SESSION)).toBe("denied");
  });

  it("reads a refused closed session as Z-03, not Z-05", () => {
    expect(teacherPageAccess("denied", "signed-out", SESSION)).toBe("expired");
    expect(teacherPageAccess("signedOut", "signed-out", SESSION)).toBe("expired");
  });

  it("reads no cookie as not signed in", () => {
    expect(teacherPageAccess("signedOut", "signed-out", undefined)).toBe("signedOut");
    expect(teacherPageAccess("denied", "signed-out", "kratko")).toBe("signedOut");
  });

  it("does not guess when the principal could not be read", () => {
    expect(teacherPageAccess("denied", "unverified", SESSION)).toBe("unavailable");
  });
});

describe("coursesAccess", () => {
  it("maps the course list read onto a teacher access", () => {
    expect(coursesAccess(null)).toBe("signedOut");
    expect(coursesAccess("unauthorized")).toBe("signedOut");
    expect(coursesAccess("not_found")).toBe("denied");
    expect(coursesAccess("ok")).toBe("allowed");
    expect(coursesAccess("unavailable")).toBe("unavailable");
  });
});
