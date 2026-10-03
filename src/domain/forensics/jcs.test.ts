import { describe, expect, it } from "vitest";

import { sha256WebCrypto } from "./crypto";
import { canonicalizeJcs } from "./jcs";

describe("RFC 8785 JCS", () => {
  it("matches the RFC 8785 serialization sample and an independent SHA-256 vector", async () => {
    const value = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
      string: "€$\u000f\nA'B\"\\\\\"/",
      literals: [null, true, false],
    };

    const canonical =
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\\\\\"/"}';

    expect(canonicalizeJcs(value)).toBe(canonical);
    expect(await sha256WebCrypto(canonical)).toBe(
      "2d5e01a318d0f0879ab568c4be289c8b1f64ef8921a53c6277d5e069978baacb",
    );
  });

  it("sorts object property names by raw UTF-16 code units and never reorders arrays", () => {
    const value = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
      nested: [{ z: 1, a: 2 }, { b: 3, a: 4 }],
    };

    const canonical = canonicalizeJcs(value);
    expect(canonical).toBe(
      '{"\\r":"Carriage Return","1":"One","nested":[{"a":2,"z":1},{"a":4,"b":3}],"\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
    expect(JSON.parse(canonical).nested).toEqual([
      { a: 2, z: 1 },
      { a: 4, b: 3 },
    ]);
  });

  it("preserves distinct Unicode normalization forms", () => {
    expect(canonicalizeJcs({ value: "é" })).not.toBe(
      canonicalizeJcs({ value: "e\u0301" }),
    );
  });

  it("fails closed on non-JSON values, non-finite numbers, lone surrogates and cycles", () => {
    expect(() => canonicalizeJcs({ x: undefined })).toThrow("unsupported value");
    expect(() => canonicalizeJcs({ x: Number.NaN })).toThrow("non-finite number");
    expect(() => canonicalizeJcs({ x: Number.POSITIVE_INFINITY })).toThrow(
      "non-finite number",
    );
    expect(() => canonicalizeJcs({ x: "\ud800" })).toThrow("lone surrogate");

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeJcs(cyclic)).toThrow("cyclic value");
  });

  it("matches representative RFC 8785 Appendix B number vectors", () => {
    const vectors: Array<[number, string]> = [
      [0, "0"],
      [-0, "0"],
      [Number.MIN_VALUE, "5e-324"],
      [-Number.MIN_VALUE, "-5e-324"],
      [Number.MAX_VALUE, "1.7976931348623157e+308"],
      [-Number.MAX_VALUE, "-1.7976931348623157e+308"],
      [2 ** 53, "9007199254740992"],
      [2 ** 68, "295147905179352830000"],
      [9.999999999999997e22, "9.999999999999997e+22"],
      [1e23, "1e+23"],
      [9.999999999999997e-7, "9.999999999999997e-7"],
      [0.000001, "0.000001"],
      [333333333.3333333, "333333333.3333333"],
      [-0.0000033333333333333333, "-0.0000033333333333333333"],
      [1424953923781206.25, "1424953923781206.2"],
    ];

    for (const [value, expected] of vectors) {
      expect(canonicalizeJcs(value)).toBe(expected);
    }
  });

  it("uses ECMAScript number serialization including negative zero", () => {
    expect(canonicalizeJcs({ n: -0, small: 0.000001, large: 1e30 })).toBe(
      '{"large":1e+30,"n":0,"small":0.000001}',
    );
  });
});
