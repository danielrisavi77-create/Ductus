import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { canonicalize } from "./integrity";
import { canonicalizeJcs } from "./jcs";

/**
 * Property tests for the two canonicalizers behind every forensic hash.
 *
 * `canonicalize` (integrity.ts) feeds the ProcessCapture hash chain;
 * `canonicalizeJcs` (jcs.ts) feeds evidence segment v2. Both must be
 * deterministic, insensitive to property insertion order, stable under a JSON
 * round trip, and must never normalize Unicode on their own: a hash covers
 * exactly the bytes that were recorded.
 */

/** JSON values with full-Unicode (well-formed) strings, including astral code points. */
const jsonValue = fc.jsonValue({ stringUnit: "binary", maxDepth: 4 });

/**
 * Rebuilds every plain object with its own keys in a different insertion order.
 * `Object.defineProperty` keeps keys such as "__proto__" as ordinary own data
 * properties instead of changing the prototype.
 */
function reorderKeys(value: unknown, rotate: number): unknown {
  if (Array.isArray(value)) return value.map((item) => reorderKeys(item, rotate));
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).reverse();
  const shift = keys.length === 0 ? 0 : rotate % keys.length;
  const ordered = [...keys.slice(shift), ...keys.slice(0, shift)];
  const target: Record<string, unknown> = {};
  for (const key of ordered) {
    Object.defineProperty(target, key, {
      value: reorderKeys(source[key], rotate),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return target;
}

describe("forensic canonicalization", () => {
  test.prop([jsonValue, fc.nat()])(
    "canonicalize ignores property insertion order",
    (value, rotate) => {
      expect(canonicalize(reorderKeys(value, rotate))).toBe(canonicalize(value));
    },
  );

  test.prop([jsonValue, fc.nat()])(
    "canonicalizeJcs ignores property insertion order",
    (value, rotate) => {
      expect(canonicalizeJcs(reorderKeys(value, rotate))).toBe(canonicalizeJcs(value));
    },
  );

  test.prop([jsonValue])("canonicalize is a fixed point under a JSON round trip", (value) => {
    const canonical = canonicalize(value);
    expect(canonicalize(JSON.parse(canonical))).toBe(canonical);
  });

  test.prop([jsonValue])("canonicalizeJcs is a fixed point under a JSON round trip", (value) => {
    const canonical = canonicalizeJcs(value);
    expect(canonicalizeJcs(JSON.parse(canonical))).toBe(canonical);
  });

  test.prop([jsonValue])(
    "both canonicalizers agree on well-formed JSON values",
    (value) => {
      expect(canonicalize(value)).toBe(canonicalizeJcs(value));
    },
  );

  test.prop([fc.string({ unit: "binary", minLength: 1 })])(
    "neither canonicalizer normalizes Unicode: NFC and NFD stay distinct whenever they differ",
    (text) => {
      const nfc = text.normalize("NFC");
      const nfd = text.normalize("NFD");
      fc.pre(nfc !== nfd);
      expect(canonicalize({ text: nfc })).not.toBe(canonicalize({ text: nfd }));
      expect(canonicalizeJcs({ text: nfc })).not.toBe(canonicalizeJcs({ text: nfd }));
    },
  );
});
