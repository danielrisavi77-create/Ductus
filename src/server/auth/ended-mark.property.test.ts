import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { ENDED_MARK_COOKIE, liveSessionToken } from "./ended-mark";
import { sessionTag } from "./principal";
import { SESSION_COOKIE_NAME } from "./session-token";

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".split("");
const token = fc.array(fc.constantFrom(...BASE64URL), { minLength: 43, maxLength: 43 }).map((c) => c.join(""));
const hexTag = fc.array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: 64, maxLength: 64 }).map((c) => c.join(""));

// DAN-99, contract on #1836: the token comes back exactly when neither a
// per-session mark nor the legacy list names its own tag; other tags never
// hide it, and the own tag, in either place, always does.
test.prop([token, fc.array(hexTag, { maxLength: 6 }), fc.array(hexTag, { maxLength: 6 }), fc.boolean(), fc.boolean()])(
  "a session reads as ended exactly when its own tag is marked",
  (value, marks, legacy, ownMark, ownLegacy) => {
    const tag = sessionTag(value)!;
    const names = new Map<string, string>([[SESSION_COOKIE_NAME, value]]);
    for (const other of marks) names.set(`${ENDED_MARK_COOKIE}-${other}`, "1");
    if (ownMark) names.set(`${ENDED_MARK_COOKIE}-${tag}`, "1");
    const list = ownLegacy ? [...legacy, tag] : legacy;
    if (list.length > 0) names.set(ENDED_MARK_COOKIE, list.join("."));

    const ended = names.has(`${ENDED_MARK_COOKIE}-${tag}`) || list.includes(tag);
    const result = liveSessionToken({ get: (name) => (names.has(name) ? { value: names.get(name)! } : undefined) });
    expect(result).toBe(ended ? undefined : value);
  },
);
