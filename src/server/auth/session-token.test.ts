import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE_NAME,
  clearedSessionCookieOptions,
  hashSessionToken,
  newSessionToken,
  sessionCookieOptions,
} from "./session-token";

// Plan of attack #154, items 13 and 14.
describe("session token", () => {
  it("is 32 random bytes in base64url, the format withActor accepts", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      const { token } = newSessionToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
      seen.add(token);
    }
    expect(seen.size).toBe(64);
  });

  it("is stored as its SHA-256 alone, never as the token or its bytes", () => {
    const { token, tokenHash } = newSessionToken();
    expect(tokenHash).toHaveLength(32);
    expect(tokenHash.equals(createHash("sha256").update(Buffer.from(token, "utf8")).digest())).toBe(true);
    expect(tokenHash.equals(Buffer.from(token, "base64url"))).toBe(false);
    expect(tokenHash.toString("base64url")).not.toBe(token);
    expect(hashSessionToken(token).equals(tokenHash)).toBe(true);
  });
});

describe("session cookie", () => {
  it("is a __Host- cookie: Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain", () => {
    const expires = new Date("2026-10-11T08:00:00Z");
    expect(SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(true);
    expect(sessionCookieOptions(expires)).toStrictEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires,
    });
  });

  it("is cleared at logout with the same attributes", () => {
    const cleared = clearedSessionCookieOptions();
    expect(cleared.expires.getTime()).toBe(0);
    expect({ ...cleared, expires: null }).toStrictEqual({ ...sessionCookieOptions(new Date()), expires: null });
    expect(cleared).not.toHaveProperty("domain");
  });
});
