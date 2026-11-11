import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { endSessionsInCookie, type CookieJar } from "@/client/session-marks";
import { institutionScreen } from "@/components/admin/institution-access";
import { teacherPageAccess } from "@/components/auth/access-kind";
import { readHome } from "@/components/shell/shell-role";
import type { TeacherAccess } from "@/components/teacher/teacher-access";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { accessCookie, endedHere, endedMarkCookie, ENDED_MARK_PREFIX } from "./ended-mark";
import { sessionPrincipal, sessionTag, type SessionPrincipal } from "./principal";

// #1929 (cxcr1929 / cxcq1929): a sign-out no longer clears the session
// cookie. The closed session's cookie must read as signed out, and the
// browser's own record of the sign-out picks the public home over Z-03.
// Every token is invented.
const TOKEN = "Ab3_".repeat(10) + "x-Z";
const OTHER = "z".repeat(43);
const TAG = sessionTag(TOKEN)!;

const jar = (...names: string[]) => (name: string) => names.includes(name);

/** A database whose current_actor() names nobody: the session is closed. */
function closedSession(): WithActor {
  const query = vi.fn(async () => ({ rows: [{ user_id: null, institution_id: null, signed_in: false, teacher: false }], rowCount: 1 }));
  return vi.fn(async (_token: string, fn: (tx: ActorTransaction) => Promise<unknown>) =>
    fn({ query } as unknown as ActorTransaction)) as unknown as WithActor;
}

describe("the cookie of a session that was signed out", () => {
  it("reads as signed out: no journal, no way into the app, and the public home", async () => {
    expect(await sessionPrincipal(TOKEN, closedSession())).toEqual({ kind: "signed-out" });
    expect(await readHome(TOKEN, closedSession())).toEqual({ path: null, scope: null, closed: true });
    expect(endedHere(TOKEN, jar(`${ENDED_MARK_PREFIX}${TAG}`))).toBe(true);
  });

  it("is the name the sign-out wrote in the browser before going on to the provider", () => {
    const stored = new Map<string, string>();
    const browser: CookieJar = {
      read: () => [...stored].map(([name, value]) => `${name}=${value}`).join("; "),
      write: (cookie) => {
        const pair = cookie.slice(0, cookie.indexOf(";"));
        stored.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
      },
      secure: true,
    };
    expect(endSessionsInCookie(browser, [TAG])).toBe(true);
    const names = [...stored.keys()];
    expect(endedHere(TOKEN, jar(...names))).toBe(true);
    expect(endedHere(OTHER, jar(...names))).toBe(false);
  });
});

describe("endedHere", () => {
  it.each([
    ["no session cookie", undefined, [`${ENDED_MARK_PREFIX}${TAG}`]],
    ["a malformed session cookie", "kratko", [`${ENDED_MARK_PREFIX}${sessionTag("kratko")}`]],
    ["the record of another session", TOKEN, [`${ENDED_MARK_PREFIX}${sessionTag(OTHER)}`]],
    ["the prefix without a tag", TOKEN, [ENDED_MARK_PREFIX]],
    ["the old list cookie", TOKEN, ["ductus-ended"]],
    ["the tag in capitals", TOKEN, [`${ENDED_MARK_PREFIX}${TAG.toUpperCase()}`]],
    ["the tag with a space", TOKEN, [`${ENDED_MARK_PREFIX}${TAG} `]],
    ["the bare tag", TOKEN, [TAG]],
    ["the session token itself in place of its tag", TOKEN, [`${ENDED_MARK_PREFIX}${TOKEN}`]],
    ["no records at all", TOKEN, []],
  ])("is false for %s", (_name, token, names) => {
    expect(endedHere(token, jar(...names))).toBe(false);
  });

  it("is true only for the exact record of the cookie's own session", () => {
    const token = fc.stringMatching(/^[A-Za-z0-9_-]{43}$/);
    fc.assert(
      fc.property(token, token, (mine, theirs) => {
        const tag = sessionTag(mine)!;
        expect(endedHere(mine, jar(`${ENDED_MARK_PREFIX}${tag}`))).toBe(true);
        expect(endedHere(theirs, jar(`${ENDED_MARK_PREFIX}${tag}`))).toBe(mine === theirs);
      }),
    );
  });
});

describe("accessCookie", () => {
  it.each([
    ["no session cookie", undefined, [`${ENDED_MARK_PREFIX}${TAG}`], undefined],
    ["a malformed session cookie", "kratko", [`${ENDED_MARK_PREFIX}${sessionTag("kratko")}`], "kratko"],
    ["no records at all", TOKEN, [], TOKEN],
    ["the record of another session", TOKEN, [`${ENDED_MARK_PREFIX}${sessionTag(OTHER)}`], TOKEN],
    ["the old list cookie", TOKEN, ["ductus-ended"], TOKEN],
    ["the tag in capitals", TOKEN, [`${ENDED_MARK_PREFIX}${TAG.toUpperCase()}`], TOKEN],
    ["the session's own record", TOKEN, [`${ENDED_MARK_PREFIX}${TAG}`], undefined],
  ])("with %s reads %s", (_name, token, names, expected) => {
    expect(accessCookie(token, jar(...names))).toBe(expected);
  });

  it("drops only the cookie whose own session this browser signed out", () => {
    const token = fc.stringMatching(/^[A-Za-z0-9_-]{43}$/);
    fc.assert(
      fc.property(token, token, (mine, theirs) => {
        const marks = jar(`${ENDED_MARK_PREFIX}${sessionTag(theirs)}`);
        expect(accessCookie(mine, marks)).toBe(mine === theirs ? undefined : mine);
      }),
    );
  });
});

// #1929, plan of #1836 c.6795886262: the mark is read only on the access
// screens, and only where the database already found the session closed.
const ACCESSES: TeacherAccess[] = ["allowed", "signedOut", "denied", "unavailable"];
const PRINCIPALS: SessionPrincipal["kind"][] = ["signed-in", "signed-out", "unverified"];
const READS = ["ok", "notFound", "unauthorized", "unavailable", null] as const;
const teacherScreens = (token: string | undefined) =>
  ACCESSES.flatMap((access) => PRINCIPALS.map((principal) => teacherPageAccess(access, principal, token)));
const institutionScreens = (token: string | undefined) =>
  READS.flatMap((read) => PRINCIPALS.map((principal) => institutionScreen(read, principal, token)));
const marked = (screen: string) => (screen === "expired" ? "signedOut" : screen);

describe("the access screens of a session that was signed out", () => {
  const mine = jar(`${ENDED_MARK_PREFIX}${TAG}`);

  it("read a closed session as signed out (I5) and leave every other screen as it was", () => {
    expect(teacherPageAccess("signedOut", "signed-out", accessCookie(TOKEN, mine))).toBe("signedOut");
    expect(institutionScreen("unauthorized", "signed-out", accessCookie(TOKEN, mine))).toBe("signedOut");
    expect(teacherScreens(accessCookie(TOKEN, mine))).toEqual(teacherScreens(TOKEN).map(marked));
    expect(institutionScreens(accessCookie(TOKEN, mine))).toEqual(institutionScreens(TOKEN).map(marked));
  });

  it("never change the page of a session the database reads as open (DAN-511b, #1444)", () => {
    expect(teacherPageAccess("allowed", "signed-in", accessCookie(TOKEN, mine))).toBe("allowed");
    expect(teacherPageAccess("denied", "signed-in", accessCookie(TOKEN, mine))).toBe("denied");
    expect(teacherPageAccess("allowed", "unverified", accessCookie(TOKEN, mine))).toBe("unavailable");
    expect(institutionScreen("ok", "signed-in", accessCookie(TOKEN, mine))).toBe("allowed");
    expect(institutionScreen("notFound", "signed-in", accessCookie(TOKEN, mine))).toBe("notFound");
    expect(institutionScreen("unavailable", "signed-out", accessCookie(TOKEN, mine))).toBe("unavailable");
  });

  it("Istodobnost: the mark of session A changes no screen of cookie B", () => {
    // A's logout answer lands after B signed in from another tab: the browser
    // keeps B's cookie and A's mark. B open stays open, B closed stays Z-03.
    const answer = endedMarkCookie(TOKEN)!;
    const markA = jar(answer.slice(0, answer.indexOf("=")));
    expect(teacherPageAccess("allowed", "signed-in", accessCookie(OTHER, markA))).toBe("allowed");
    expect(institutionScreen("ok", "signed-in", accessCookie(OTHER, markA))).toBe("allowed");
    expect(teacherScreens(accessCookie(OTHER, markA))).toEqual(teacherScreens(OTHER));
    expect(institutionScreens(accessCookie(OTHER, markA))).toEqual(institutionScreens(OTHER));
    expect(teacherPageAccess("signedOut", "signed-out", accessCookie(OTHER, markA))).toBe("expired");
    // Only B's own later sign-out reads B as signed out.
    const both = jar(answer.slice(0, answer.indexOf("=")), `${ENDED_MARK_PREFIX}${sessionTag(OTHER)}`);
    expect(teacherPageAccess("signedOut", "signed-out", accessCookie(OTHER, both))).toBe("signedOut");
    expect(teacherPageAccess("allowed", "signed-in", accessCookie(OTHER, both))).toBe("allowed");
  });
});

describe("endedMarkCookie", () => {
  it("names the closed session's tag, is readable by the page and names no token", () => {
    const answer = endedMarkCookie(TOKEN)!;
    expect(answer.startsWith(`${ENDED_MARK_PREFIX}${TAG}=1;`)).toBe(true);
    expect(answer).not.toMatch(/HttpOnly/i);
    expect(answer).not.toContain(TOKEN);
    expect(endedMarkCookie(undefined)).toBeNull();
    expect(endedMarkCookie("kratko")).toBeNull();
  });
});
