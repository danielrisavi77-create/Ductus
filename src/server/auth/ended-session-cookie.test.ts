import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ENDED_MARK_PREFIX, endedMarkCookie } from "./ended-mark";
import { withoutEndedSession } from "./ended-session-cookie";
import { SESSION_TAG_LABEL, sessionTag } from "./principal";
import { SESSION_COOKIE_NAME } from "./session-token";

// #1929: the logout answer marks the closed session's tag and the middleware
// drops that cookie from page requests, so a sign-out without JavaScript also
// reads as signed out. Every token is invented.
const A = "a".repeat(43);
const B = "Bb_-".repeat(10) + "b9Z";
const session = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;
const markOf = (token: string) => `${ENDED_MARK_PREFIX}${sessionTag(token)}=1`;
/** What a browser keeps of a Set-Cookie: the name and the value. */
const stored = (setCookie: string) => setCookie.slice(0, setCookie.indexOf(";"));

describe("withoutEndedSession", () => {
  it("uses the server's own names and tag (edge copy of session-token.ts and principal.ts)", async () => {
    expect(SESSION_TAG_LABEL).toBe("ductus-session-tag-v1");
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[A-Za-z0-9_-]{43}$/), async (token) => {
        expect(await withoutEndedSession(`${session(token)}; ${markOf(token)}`)).toBe(markOf(token));
      }),
      { numRuns: 50 },
    );
  });

  it("drops the session cookie of a session signed out here and keeps every other cookie", async () => {
    expect(await withoutEndedSession(`x=1; ${session(A)}; ${markOf(A)}; y=2`)).toBe(`x=1; ${markOf(A)}; y=2`);
  });

  it.each([
    ["no Cookie header", null],
    ["no session cookie", `${markOf(A)}; x=1`],
    ["no mark", `${session(A)}; x=1`],
    ["the mark of another session", `${session(A)}; ${markOf(B)}`],
    ["a malformed session cookie", `${SESSION_COOKIE_NAME}=kratko; ${ENDED_MARK_PREFIX}${"0".repeat(64)}=1`],
    ["a mark in capitals", `${session(A)}; ${ENDED_MARK_PREFIX}${sessionTag(A)!.toUpperCase()}=1`],
  ])("changes nothing with %s", async (_name, header) => {
    expect(await withoutEndedSession(header)).toBeNull();
  });

  it("Istodobnost: A's logout answer lands after B signed in from another tab, and B stays signed in", async () => {
    // The first POST read A's cookie; B's sign-in replaced it; then A's answer arrives.
    const answer = endedMarkCookie(A)!;
    expect(stored(answer)).toBe(markOf(A));
    const jar = `${session(B)}; ${stored(answer)}`;
    expect(await withoutEndedSession(jar)).toBeNull();
    // Only B's own later sign-out drops B.
    expect(await withoutEndedSession(`${jar}; ${stored(endedMarkCookie(B)!)}`)).toBe(`${markOf(A)}; ${markOf(B)}`);
  });

  it("the mark is readable by the page and names no token", () => {
    const answer = endedMarkCookie(A)!;
    expect(answer).not.toMatch(/HttpOnly/i);
    expect(answer).not.toContain(A);
    expect(endedMarkCookie(undefined)).toBeNull();
    expect(endedMarkCookie("kratko")).toBeNull();
  });
});
