import { describe, expect, it } from "vitest";

import { signInHref, signInTarget } from "./sign-in-link";

describe("signInTarget", () => {
  it("defaults to the workspace", () => {
    for (const raw of [undefined, null, "", "/", ["/rad", "/upis"]]) {
      expect(signInTarget(raw)).toBe("/rad");
    }
  });

  it("keeps a path of this application", () => {
    expect(signInTarget("/zadatak/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(
      "/zadatak/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(signInTarget("/upis?kod=AB12")).toBe("/upis?kod=AB12");
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
      expect(signInTarget(raw), String(raw)).toBe("/rad");
    }
  });
});

describe("signInHref", () => {
  it("points at the login route with an encoded returnTo", () => {
    expect(signInHref("/rad")).toBe("/api/auth/login?returnTo=%2Frad");
    expect(signInHref("/upis?kod=AB12")).toBe("/api/auth/login?returnTo=%2Fupis%3Fkod%3DAB12");
  });
});
