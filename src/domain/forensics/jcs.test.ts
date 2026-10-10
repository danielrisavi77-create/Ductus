import { describe, expect, it } from "vitest";

import { sha256WebCrypto } from "./crypto";
import { canonicalizeJcs, MAX_JCS_DEPTH } from "./jcs";

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

  describe("nesting limit", () => {
    const nested = (depth: number, leaf: unknown = 1, withObjects = false) => {
      let value = leaf;
      for (let level = 0; level < depth; level++) {
        value = withObjects && level % 2 === 0 ? { k: value } : [value];
      }
      return value;
    };

    // The limit decides what both sides may hash, so it is part of the v2
    // format (docs/BACKEND.md section 4.1). The numbers are written out here
    // on purpose: changing the constant alone must fail this test.
    it("is 256 levels: a value 256 deep has a canonical form, one 257 deep has none", () => {
      expect(MAX_JCS_DEPTH).toBe(256);
      expect(canonicalizeJcs(nested(256))).toBe(
        "[".repeat(256) + "1" + "]".repeat(256),
      );
      expect(() => canonicalizeJcs(nested(256, 1, true))).not.toThrow();
      expect(() => canonicalizeJcs(nested(257))).toThrow("jcs: nesting too deep");
      expect(() => canonicalizeJcs(nested(257, 1, true))).toThrow(
        "jcs: nesting too deep",
      );
    });

    it("canonicalizes a value nested exactly to the limit", () => {
      expect(canonicalizeJcs(nested(MAX_JCS_DEPTH))).toBe(
        "[".repeat(MAX_JCS_DEPTH) + "1" + "]".repeat(MAX_JCS_DEPTH),
      );
      expect(() => canonicalizeJcs(nested(MAX_JCS_DEPTH, 1, true))).not.toThrow();
      // An empty container is a level too.
      expect(() => canonicalizeJcs(nested(MAX_JCS_DEPTH - 1, []))).not.toThrow();
      expect(() => canonicalizeJcs(nested(MAX_JCS_DEPTH - 1, {}))).not.toThrow();
    });

    it("rejects one level more with its own error, whatever sits at the bottom", () => {
      for (const value of [
        nested(MAX_JCS_DEPTH + 1),
        nested(MAX_JCS_DEPTH + 1, "x", true),
        nested(MAX_JCS_DEPTH, []),
        nested(MAX_JCS_DEPTH, {}),
        { steps: nested(MAX_JCS_DEPTH) },
      ]) {
        expect(() => canonicalizeJcs(value)).toThrow("jcs: nesting too deep");
      }
    });

    it("gives the same error far past the depth where a stack would overflow", () => {
      for (const depth of [5_000, 20_000, 200_000]) {
        expect(() => canonicalizeJcs(nested(depth))).toThrow(
          "jcs: nesting too deep",
        );
      }
    });

    it("does not count siblings: a wide value is not a deep one", () => {
      const wide = Array.from({ length: 10_000 }, (_, index) => ({ index }));
      expect(() => canonicalizeJcs(wide)).not.toThrow();
    });
  });

  it("rejects sparse arrays instead of hashing them as shorter arrays", () => {
    expect(() => canonicalizeJcs({ steps: new Array(1) })).toThrow("sparse array");
    expect(() => canonicalizeJcs([1, , 3])).toThrow("sparse array");
  });
});
