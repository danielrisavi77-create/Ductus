import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { endSessionsInCookie, type CookieJar } from "@/client/session-marks";
import { readHome } from "@/components/shell/shell-role";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { endedHere, ENDED_MARK_PREFIX } from "./ended-mark";
import { sessionPrincipal, sessionTag } from "./principal";

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
