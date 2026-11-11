import { describe, expect, it } from "vitest";

import { ENDED_MARK_COOKIE, liveSessionToken } from "./ended-mark";
import { sessionTag } from "./principal";
import { SESSION_COOKIE_NAME } from "./session-token";

// Invented tokens: 43 characters of the base64url alphabet, never a real cookie.
const TOKEN = "A".repeat(42) + "b";
const OTHER = "C".repeat(42) + "d";
const TAG = sessionTag(TOKEN)!;
const OTHER_TAG = sessionTag(OTHER)!;

function jar(cookies: Record<string, string>) {
  return { get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined) };
}

const mark = (tag: string) => `${ENDED_MARK_COOKIE}-${tag}`;

// The input classes of the contract on #1836 (D-288 t. a), one row each.
describe("liveSessionToken: input classes", () => {
  const rows: Array<[string, Record<string, string>, string | undefined]> = [
    ["1 no session cookie", { [mark(TAG)]: "1" }, undefined],
    ["2 malformed session cookie", { [SESSION_COOKIE_NAME]: "kratko", [mark(TAG)]: "1" }, "kratko"],
    ["3 valid cookie, no marks", { [SESSION_COOKIE_NAME]: TOKEN }, TOKEN],
    ["4 own mark", { [SESSION_COOKIE_NAME]: TOKEN, [mark(TAG)]: "1" }, undefined],
    ["5 only another session's mark", { [SESSION_COOKIE_NAME]: TOKEN, [mark(OTHER_TAG)]: "1" }, TOKEN],
    ["6 own mark with an empty value", { [SESSION_COOKIE_NAME]: TOKEN, [mark(TAG)]: "" }, undefined],
    ["7 legacy list holding the own tag", { [SESSION_COOKIE_NAME]: TOKEN, [ENDED_MARK_COOKIE]: `${OTHER_TAG}.${TAG}` }, undefined],
    ["8 legacy list without the own tag", { [SESSION_COOKIE_NAME]: TOKEN, [ENDED_MARK_COOKIE]: `${OTHER_TAG}.abc` }, TOKEN],
    ["9 own tag in upper case", { [SESSION_COOKIE_NAME]: TOKEN, [mark(TAG.toUpperCase())]: "1", [ENDED_MARK_COOKIE]: TAG.toUpperCase() }, TOKEN],
    ["10 several marks, the own among them", { [SESSION_COOKIE_NAME]: TOKEN, [mark(OTHER_TAG)]: "1", [mark(TAG)]: "1" }, undefined],
    ["11 a name that only starts with the own tag", { [SESSION_COOKIE_NAME]: TOKEN, [`${mark(TAG)}x`]: "1", [ENDED_MARK_COOKIE]: `${TAG}x.x${TAG}` }, TOKEN],
  ];

  it.each(rows)("%s", (_, cookies, expected) => {
    expect(liveSessionToken(jar(cookies))).toBe(expected);
  });

  it("asks for nothing but cookies by name and changes none", () => {
    const asked: string[] = [];
    const cookies = { [SESSION_COOKIE_NAME]: TOKEN, [mark(TAG)]: "1" };
    liveSessionToken({ get: (name) => { asked.push(name); return jar(cookies).get(name); } });
    expect(asked).toEqual([SESSION_COOKIE_NAME, mark(TAG)]);
    expect(cookies).toEqual({ [SESSION_COOKIE_NAME]: TOKEN, [mark(TAG)]: "1" });
  });
});
