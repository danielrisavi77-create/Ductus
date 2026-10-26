import { describe, expect, it } from "vitest";

import { signedInRedirect, signInHref, signInTarget } from "./sign-in-link";

describe("signInTarget", () => {
  // DAN-325: "/" sends the signed-in person on by role, never to /rad for all.
  it("defaults to the home page", () => {
    for (const raw of [undefined, null, "", "/", ["/rad", "/upis"]]) {
      expect(signInTarget(raw)).toBe("/");
    }
  });

  it("keeps a path of this application", () => {
    expect(signInTarget("/zadatak/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(
      "/zadatak/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(signInTarget("/upis?kod=AB12")).toBe("/upis?kod=AB12");
    expect(signInTarget("/rad")).toBe("/rad");
    expect(signInTarget("/nastavnik")).toBe("/nastavnik");
  });

  it("refuses another origin and the auth routes", () => {
    for (const raw of [
      "https://example.test/rad",
      "//example.test",
      "/\\example.test",
      "javascript:alert(1)",
      "/api/auth/login",
      "/%2561pi/auth/logout",
      "rad",
    ]) {
      expect(signInTarget(raw), String(raw)).toBe("/");
    }
  });
});

describe("signInHref", () => {
  it("points at the login route with an encoded returnTo", () => {
    expect(signInHref("/")).toBe("/api/auth/login?returnTo=%2F");
    expect(signInHref("/rad")).toBe("/api/auth/login?returnTo=%2Frad");
    expect(signInHref("/upis?kod=AB12")).toBe("/api/auth/login?returnTo=%2Fupis%3Fkod%3DAB12");
  });
});

// F-151 part 1 (DAN-342): /prijava decides by the cookie's shape alone.
describe("signedInRedirect", () => {
  it("sends a session-shaped cookie on to the home page, which makes the one read", () => {
    for (const token of ["A".repeat(43), "z_-9".repeat(10) + "abc"]) {
      expect(signedInRedirect(token)).toBe("/");
    }
  });

  it("keeps the sign-in screen without a cookie or with a malformed one", () => {
    for (const token of [undefined, "", "kratko", `${"A".repeat(43)}!`, "A".repeat(44)]) {
      expect(signedInRedirect(token)).toBeNull();
    }
  });
});
