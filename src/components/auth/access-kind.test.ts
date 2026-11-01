import { describe, expect, it } from "vitest";

import { accountPlace } from "@/components/shell/nav";

import { accessShellScope, closedSessionKind, coursesAccess, teacherPageAccess } from "./access-kind";

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

describe("accessShellScope", () => {
  const open = { kind: "signed-in", scope: "f".repeat(64) } as const;

  it("gives Z-03 and \"not signed in\" no scope, so no sign-out (#1231)", () => {
    for (const principal of [open, { kind: "signed-out" } as const, { kind: "unverified" } as const]) {
      expect(accessShellScope("expired", principal)).toBeNull();
      expect(accessShellScope("signedOut", principal)).toBeNull();
    }
  });

  it("a course list refused as closed beside an open principal reads Z-03 without a sign-out (#1242 c.6563600266)", () => {
    // The principal read the session open, then it closed before the list read (ZD401).
    const screen = teacherPageAccess(coursesAccess("unauthorized"), open.kind, SESSION);
    expect(screen).toBe("expired");
    expect(accessShellScope(screen, open)).toBeNull();
    expect(accountPlace(accessShellScope(screen, open), false)).toBe("none");
  });

  it("keeps the signed-in scope on the page, on Z-05 and when the read is unavailable", () => {
    for (const screen of ["allowed", "denied", "unavailable"] as const) {
      expect(accessShellScope(screen, open)).toBe(open.scope);
      expect(accessShellScope(screen, { kind: "signed-out" })).toBeNull();
    }
  });
});
