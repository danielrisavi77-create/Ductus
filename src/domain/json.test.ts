import { describe, expect, it } from "vitest";

import { hasOnlyKeys, isPlainObject, ownProperty } from "./json";

/**
 * The prototype rule these two encode is a security rule (F1-10), and it is
 * now shared by every module that reads an untrusted payload — the canonical
 * document validator, the two RPC contracts, the Tiptap interop and the
 * commit action. Those modules test the rule through their own parsers; this
 * file tests it directly, so a change to the shared copy fails here first and
 * says what actually broke.
 */
describe("isPlainObject", () => {
  it("accepts object literals and null-prototype objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(JSON.parse('{"__proto__": {"x": 1}}'))).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(1)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
  });

  it("rejects arrays", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([{ a: 1 }])).toBe(false);
  });

  it("rejects anything with a surprising prototype", () => {
    class Impostor {
      status = "committed";
    }
    expect(isPlainObject(new Impostor())).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
    expect(isPlainObject(() => {})).toBe(false);
  });
});

describe("hasOnlyKeys", () => {
  const allowed = new Set(["status", "revision"]);

  it("accepts any subset of the allowed keys", () => {
    expect(hasOnlyKeys({}, allowed)).toBe(true);
    expect(hasOnlyKeys({ status: "committed" }, allowed)).toBe(true);
    expect(hasOnlyKeys({ status: "committed", revision: 1 }, allowed)).toBe(true);
  });

  it("rejects one unknown key, also one that is undefined or named like a prototype member", () => {
    expect(hasOnlyKeys({ status: "committed", extra: 1 }, allowed)).toBe(false);
    expect(hasOnlyKeys({ extra: undefined }, allowed)).toBe(false);
    expect(hasOnlyKeys(JSON.parse('{"__proto__": 1}'), allowed)).toBe(false);
    expect(hasOnlyKeys(JSON.parse('{"constructor": 1}'), allowed)).toBe(false);
  });

  it("counts symbol and non-enumerable keys as unknown", () => {
    expect(hasOnlyKeys({ [Symbol("hidden")]: 1 } as Record<string, unknown>, allowed)).toBe(false);
    const hidden = Object.defineProperty({ status: "committed" }, "extra", {
      value: 1,
      enumerable: false,
    });
    expect(hasOnlyKeys(hidden, allowed)).toBe(false);
  });
});

describe("ownProperty", () => {
  it("reads own properties", () => {
    expect(ownProperty({ status: "committed" }, "status")).toBe("committed");
    expect(ownProperty({ revision: 0 }, "revision")).toBe(0);
  });

  it("returns undefined for a missing key", () => {
    expect(ownProperty({}, "status")).toBeUndefined();
  });

  it("never walks the prototype chain", () => {
    expect(ownProperty({}, "constructor")).toBeUndefined();
    expect(ownProperty({}, "toString")).toBeUndefined();
    expect(ownProperty({}, "hasOwnProperty")).toBeUndefined();
    expect(ownProperty({}, "__proto__")).toBeUndefined();
  });

  it("reads an own key that shadows a prototype member", () => {
    const forged = JSON.parse('{"toString": "mine"}') as Record<string, unknown>;
    expect(ownProperty(forged, "toString")).toBe("mine");
  });
});
