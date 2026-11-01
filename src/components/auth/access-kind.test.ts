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
  it("keeps an unavailable check as it is", () => {
    for (const principal of ["signed-in", "signed-out", "unverified"] as const) {
      expect(teacherPageAccess("unavailable", principal, SESSION)).toBe("unavailable");
    }
  });

  it("shows the page only to a signed-in principal", () => {
    expect(teacherPageAccess("allowed", "signed-in", SESSION)).toBe("allowed");
  });

  // #1242 c.6563056077: the role read said "allowed", then the session closed
  // before the principal read. The page shows Z-03, not its content.
  it("reads an allowed check beside a closed principal as Z-03, never the page", () => {
    expect(teacherPageAccess("allowed", "signed-out", SESSION)).toBe("expired");
    expect(teacherPageAccess("allowed", "unverified", SESSION)).toBe("unavailable");
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
